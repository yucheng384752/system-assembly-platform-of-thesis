"""第二階段（入庫單、回鍋單、備註、附件）規則、設定與接線的行為測試。

執行（不需第三方套件）：
  PYTHONPATH=kits/batch-production-kit/src/backend python -m unittest discover -s kits/batch-production-kit/tests
"""

import unittest
from decimal import Decimal as D

from app.core import extension_points
from app.core.attachment_rules import AttachmentError, sanitize_filename, sniff, validate_upload
from app.core.extras_settings import ExtrasSettingsError, load_extras_settings
from app.core.extras_startup import apply_settings
from app.core.note_rules import NoteError, clean_note
from app.core.rework_rules import ReworkError, validate_confirm, validate_create
from app.core.warehouse_rules import WarehouseError, can_edit, normalize_lines, validate_for_submit

JPEG = b"\xff\xd8\xff\xe0" + b"0" * 20
PNG = b"\x89PNG\r\n\x1a\n" + b"0" * 20
WEBP = b"RIFF\x00\x00\x00\x00WEBPVP8 " + b"0" * 10


class WarehouseTest(unittest.TestCase):
    def test_submit_requires_quantity_and_unit(self):
        for qty, unit in ((None, "kg"), (0, "kg"), (-1, "kg"), (5, ""), (5, None), ("x", "kg"), (True, "kg")):
            with self.subTest(qty=qty, unit=unit), self.assertRaises(WarehouseError):
                validate_for_submit(qty, unit, [])
        self.assertEqual(validate_for_submit(5, "kg", []), [])

    def test_lines_must_add_up_exactly(self):
        lines = [{"label": "A", "qty": "2.5"}, {"label": "B", "qty": "2.5"}]
        self.assertEqual(validate_for_submit(5, "kg", lines), [{"label": "A", "qty": "2.5"}, {"label": "B", "qty": "2.5"}])
        with self.assertRaisesRegex(WarehouseError, "不符"):
            validate_for_submit(5, "kg", [{"label": "A", "qty": "2"}, {"label": "B", "qty": "2.5"}])

    def test_decimal_sum_has_no_float_error(self):
        lines = [{"label": "A", "qty": "0.1"}, {"label": "B", "qty": "0.2"}]
        validate_for_submit(D("0.3"), "kg", lines)

    def test_line_errors(self):
        for bad in ([{"label": "", "qty": 1}], [{"label": "A", "qty": 0}], [{"label": "A", "qty": "abc"}], [{"label": "A"}]):
            with self.subTest(bad=bad), self.assertRaises(WarehouseError):
                normalize_lines(bad)

    def test_edit_rules(self):
        self.assertTrue(can_edit(None, "in_progress"))
        self.assertTrue(can_edit("draft", "in_progress"))
        self.assertFalse(can_edit("submitted", "in_progress"))
        self.assertFalse(can_edit("draft", "completed"))


class ReworkTest(unittest.TestCase):
    def test_create(self):
        self.assertEqual(validate_create(2, " 回鍋 "), D(2))
        for qty, reason in ((0, "x"), (-1, "x"), ("a", "x"), (1, " "), (float("inf"), "x")):
            with self.subTest(qty=qty, reason=reason), self.assertRaises(ReworkError):
                validate_create(qty, reason)

    def test_confirm(self):
        validate_confirm(1, 2, "pending", True)
        validate_confirm(1, 1, "pending", False)
        with self.assertRaisesRegex(ReworkError, "本人"):
            validate_confirm(1, 1, "pending", True)
        with self.assertRaisesRegex(ReworkError, "已確認"):
            validate_confirm(1, 2, "confirmed", True)


class NoteTest(unittest.TestCase):
    def test_clean(self):
        self.assertEqual(clean_note("  ok "), "ok")
        for bad in ("", "   ", "x" * 1001):
            with self.subTest(n=len(bad)), self.assertRaises(NoteError):
                clean_note(bad)
        clean_note("x" * 1000)


class AttachmentTest(unittest.TestCase):
    KEYS = {"front"}

    def test_sniff_real_formats(self):
        self.assertEqual((sniff(JPEG), sniff(PNG), sniff(WEBP)), ("image/jpeg", "image/png", "image/webp"))
        self.assertIsNone(sniff(b"GIF89a"))
        self.assertIsNone(sniff(b"<html>"))

    def test_valid_upload_returns_detected_type(self):
        self.assertEqual(validate_upload("front", self.KEYS, PNG), "image/png")

    def test_rejections(self):
        with self.assertRaisesRegex(AttachmentError, "欄位"):
            validate_upload("other", self.KEYS, PNG)
        with self.assertRaisesRegex(AttachmentError, "空"):
            validate_upload("front", self.KEYS, b"")
        with self.assertRaisesRegex(AttachmentError, "上限"):
            validate_upload("front", self.KEYS, PNG + b"0" * 100, max_bytes=50)
        with self.assertRaisesRegex(AttachmentError, "圖片"):
            validate_upload("front", self.KEYS, b"<script>alert(1)</script>")
        with self.assertRaisesRegex(AttachmentError, "圖片"):
            validate_upload("front", self.KEYS, WEBP, allowed_types=("image/png",))

    def test_filename_is_neutralised(self):
        self.assertEqual(sanitize_filename("../../etc/passwd"), "passwd")
        self.assertEqual(sanitize_filename("C:\\x\\a b.png"), "a_b.png")
        self.assertEqual(sanitize_filename(".hidden"), "hidden")
        self.assertEqual(sanitize_filename("照片 1.jpg"), "照片_1.jpg")
        self.assertEqual(sanitize_filename(None), "file")
        self.assertEqual(sanitize_filename("a\x00b\n.png"), "ab.png")
        self.assertLessEqual(len(sanitize_filename("a" * 500)), 100)


class SettingsTest(unittest.TestCase):
    def test_defaults_enable_nothing(self):
        s = load_extras_settings({})
        self.assertEqual((s.enabled, s.require_warehouse_entry, s.rework_confirmer_must_differ), (frozenset(), False, True))

    def test_bad_values(self):
        for raw in ({"x": 1}, {"enabled": ["ghost"]}, {"attachmentMaxBytes": 0}, {"attachmentMaxBytes": 10**9}):
            with self.subTest(raw=raw), self.assertRaises(ExtrasSettingsError):
                load_extras_settings(raw)


class WiringTest(unittest.TestCase):
    def setUp(self):
        self._saved = (extension_points.uploaded_attachment_keys, extension_points.has_warehouse_entry,
                       extension_points.require_warehouse_entry, list(extension_points.completion_checks), extension_points.object_store)

    def tearDown(self):
        (extension_points.uploaded_attachment_keys, extension_points.has_warehouse_entry, extension_points.require_warehouse_entry,
         checks, extension_points.object_store) = self._saved
        extension_points.completion_checks[:] = checks

    def test_nothing_enabled_leaves_the_slots_alone(self):
        before = (extension_points.uploaded_attachment_keys, extension_points.has_warehouse_entry, len(extension_points.completion_checks))
        apply_settings({})
        self.assertEqual((extension_points.uploaded_attachment_keys, extension_points.has_warehouse_entry, len(extension_points.completion_checks)), before)
        self.assertFalse(extension_points.require_warehouse_entry)

    def test_enabled_features_fill_their_slots(self):
        store = object()
        apply_settings({"enabled": ["warehouse-entry", "rework-record", "attachments"], "requireWarehouseEntry": True}, object_store=store)
        self.assertTrue(extension_points.require_warehouse_entry)
        self.assertEqual(len(extension_points.completion_checks), 1)
        self.assertIs(extension_points.object_store, store)

    def test_applying_twice_does_not_duplicate_the_check(self):
        apply_settings({"enabled": ["rework-record"]})
        apply_settings({"enabled": ["rework-record"]})
        self.assertEqual(len(extension_points.completion_checks), 1)

    def test_rework_blocking_can_be_turned_off(self):
        apply_settings({"enabled": ["rework-record"], "blockOnPendingRework": False})
        self.assertEqual(extension_points.completion_checks, [])


if __name__ == "__main__":
    unittest.main()
