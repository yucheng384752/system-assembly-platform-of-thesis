"""The guard must report exactly what the installer put into the license (D136, D143).

A license is issued from services/installer/engine/detect.py; the guard reports from the same kind of
sysfs tree inside a container. If the two ever disagree, every installed system would look copied.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest

REPO = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO / 'services/installer/engine'))
import detect  # noqa: E402

spec = importlib.util.spec_from_file_location('guard_template', REPO / 'services/package/templates/guard.py')
guard = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = guard
spec.loader.exec_module(guard)


def put(path, text, binary=False):
    path.parent.mkdir(parents=True, exist_ok=True)
    if binary:
        path.write_bytes(text)
    else:
        path.write_text(text, encoding='utf-8')


def machine(root, usb_link=False):
    """A sysfs tree with valid, placeholder, virtual, removable and padded values."""
    dmi = root / 'class/dmi/id'
    put(dmi / 'product_uuid', '  4C4C4544-0042-3010-8051-C4C04F4B4E32 \n')
    put(dmi / 'product_serial', 'To Be Filled By O.E.M.\n')
    put(dmi / 'board_serial', '/CN7016/\n')
    put(dmi / 'chassis_serial', '00000000\n')
    for name, mac, physical in (('eno1', 'AA:BB:CC:DD:EE:01', True), ('docker0', '02:42:ac:11:00:01', False),
                                ('enp3s0', 'aa:bb:cc:dd:ee:02', True), ('lo', '00:00:00:00:00:00', False)):
        put(root / 'class/net' / name / 'address', mac + '\n')
        if physical:
            put(root / 'class/net' / name / 'device/uevent', '')
    put(root / 'block/sda/device/serial', ' WD-WCC4N0AB1234 \n')
    put(root / 'block/sdb/device/vpd_pg80', b'\x00\x80\x00\x08  S3Z9NX0M123456\x00  ', binary=True)
    put(root / 'block/sdb/removable', '0\n')
    put(root / 'block/sdc/device/serial', 'USBSTICK-0001\n')
    put(root / 'block/sdc/removable', '1\n')
    for name in ('loop0', 'dm-0', 'md0', 'zram0', 'sr0', 'nbd0'):
        put(root / 'block' / name / 'device/serial', 'virtual-' + name)
    put(root / 'block/sdd/device/serial', 'to be filled by o.e.m.')
    put(root / 'block/sde/device/serial', 'FFFFFFFF')


class GuardTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.base = Path(self.tmp.name)

    def installer_sources(self, root):
        return [{'source': s['source'], 'sha256': s['sha256']} for s in detect.fingerprint(root)['sources'] if s['valid']]

    def test_guard_reports_exactly_what_the_installer_would_put_in_the_license(self):
        root = self.base / 'sys'
        machine(root)
        reported = guard.collect(root)
        self.assertEqual(reported, self.installer_sources(root))
        names = {item['source'] for item in reported}
        self.assertEqual(names, {'product_uuid', 'board_serial', 'mac:eno1', 'mac:enp3s0', 'disk:sda', 'disk:sdb'})
        # Excluded on purpose: placeholders, virtual NICs, removable and virtual disks.
        for excluded in ('product_serial', 'chassis_serial', 'mac:docker0', 'mac:lo', 'disk:sdc', 'disk:loop0', 'disk:sdd', 'disk:sde'):
            self.assertNotIn(excluded, names)

    def test_values_are_normalized_before_hashing_like_the_license_tool(self):
        root = self.base / 'sys'
        machine(root)
        by_name = {item['source']: item['sha256'] for item in guard.collect(root)}
        self.assertEqual(by_name['product_uuid'], hashlib.sha256(b'4c4c4544-0042-3010-8051-c4c04f4b4e32').hexdigest())
        self.assertEqual(by_name['disk:sdb'], hashlib.sha256(b's3z9nx0m123456').hexdigest())
        self.assertNotIn('raw', json.dumps(guard.collect(root)).lower())

    def test_empty_or_unreadable_tree_reports_nothing_instead_of_failing(self):
        self.assertEqual(guard.collect(self.base / 'absent'), [])
        self.assertEqual(guard.collect(self.base / 'absent'), self.installer_sources(self.base / 'absent'))

    def test_usb_path_is_excluded_even_when_not_flagged_removable(self):
        root = self.base / 'sys'
        machine(root)
        usb = root / 'devices/pci0000-00/0000-00-14.0/usb1/1-1/host6/target6/block/sdf'
        put(usb / 'device/serial', 'STICK-2')
        try:
            os.symlink(usb, root / 'block/sdf', target_is_directory=True)
        except (OSError, NotImplementedError):
            self.skipTest('symlinks are not available on this platform; run on Ubuntu')
        self.assertNotIn('disk:sdf', {item['source'] for item in guard.collect(root)})
        self.assertEqual(guard.collect(root), self.installer_sources(root))

    def test_report_carries_times_and_only_hashes(self):
        root = self.base / 'sys'
        machine(root)
        started = guard.datetime(2026, 10, 28, 1, 0, 0, tzinfo=guard.timezone.utc)
        now = guard.datetime(2026, 10, 28, 1, 5, 0, tzinfo=guard.timezone.utc)
        value = guard.report(root, started, now)
        self.assertEqual((value['schemaVersion'], value['generatedAt'], value['startedAt']),
                         ('1.0', '2026-10-28T01:05:00Z', '2026-10-28T01:00:00Z'))
        for item in value['sources']:
            self.assertEqual(set(item), {'source', 'sha256'})
            self.assertRegex(item['sha256'], r'^[a-f0-9]{64}$')

    def test_write_is_atomic_replaces_the_previous_report_and_leaves_no_temporary_file(self):
        target = self.base / 'result.json'
        guard.write_atomic(target, {'n': 1})
        guard.write_atomic(target, {'n': 2})
        self.assertEqual(json.loads(target.read_text()), {'n': 2})
        self.assertEqual([p.name for p in self.base.iterdir()], ['result.json'])
        if os.name != 'nt':
            self.assertEqual(stat.S_IMODE(target.stat().st_mode), 0o644)

    def test_a_failed_write_keeps_the_previous_report(self):
        target = self.base / 'result.json'
        guard.write_atomic(target, {'n': 1})
        with self.assertRaises(TypeError):
            guard.write_atomic(target, {'n': object()})
        self.assertEqual(json.loads(target.read_text()), {'n': 1})
        self.assertEqual([p.name for p in self.base.iterdir()], ['result.json'])

    def test_loop_reports_every_interval_and_survives_a_failing_write(self):
        root = self.base / 'sys'
        machine(root)
        result = self.base / 'out/result.json'
        result.parent.mkdir()
        sleeps = []
        guard.main({'GUARD_SYS_ROOT': str(root), 'GUARD_RESULT_FILE': str(result), 'GUARD_INTERVAL': '7'},
                   sleep=sleeps.append, iterations=3)
        self.assertEqual(sleeps, [7, 7])
        self.assertEqual(len(json.loads(result.read_text())['sources']), 6)
        # A directory that does not exist makes every write fail; the loop must carry on, not crash.
        guard.main({'GUARD_SYS_ROOT': str(root), 'GUARD_RESULT_FILE': str(self.base / 'missing/result.json')},
                   sleep=lambda _: None, iterations=2)


if __name__ == '__main__':
    unittest.main()
