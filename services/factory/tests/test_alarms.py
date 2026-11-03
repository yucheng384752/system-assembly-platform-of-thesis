"""Alarms and held nodes on the in-memory reference store."""
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
from alarm_cases import AlarmCases
from factory_core.store import MemoryStore


class MemoryAlarmTests(AlarmCases, unittest.TestCase):
    def make_store(self):
        return MemoryStore()


if __name__ == '__main__':
    unittest.main()
