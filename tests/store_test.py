import json
import os
import sqlite3
import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STORE = ROOT / ".opencode" / "cost-predictor" / "store.py"


class StoreTest(unittest.TestCase):
    def run_store(self, *args, home):
        env = os.environ.copy()
        env["OPENCODE_COST_PREDICTOR_HOME"] = str(home)
        result = subprocess.run(
            ["python3", str(STORE), *args],
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            check=True,
        )
        return result.stdout

    def test_records_pending_terminal_and_user_label(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            payload = {
                "sessionKey": "test-session",
                "sessionId": "test-session",
                "projectDir": str(ROOT),
                "createdAt": "2026-06-29T12:00:00Z",
                "eventType": "command_observed",
                "command": "git commit -m fix",
                "triggerType": "git_commit",
            }

            self.run_store(
                "record-command",
                "--project-dir",
                str(ROOT),
                "--payload-json",
                json.dumps(payload),
                home=home,
            )
            self.run_store(
                "record-terminal",
                "--project-dir",
                str(ROOT),
                "--payload-json",
                json.dumps(
                    {
                        **payload,
                        "triggerCommand": "git commit -m fix",
                        "outcome": "awaiting_label",
                        "labelSource": "pending_user",
                    }
                ),
                home=home,
            )

            pending = json.loads(self.run_store("pending", home=home))
            self.assertEqual(len(pending), 1)
            self.assertEqual(pending[0]["trigger_type"], "git_commit")

            labeled = json.loads(
                self.run_store(
                    "label",
                    "--project-dir",
                    str(ROOT),
                    "--outcome",
                    "success",
                    home=home,
                )
            )
            self.assertEqual(labeled["outcome"], "success")

            conn = sqlite3.connect(home / "traces.sqlite")
            conn.row_factory = sqlite3.Row
            row = conn.execute("SELECT outcome, label_source FROM terminal_records").fetchone()
            self.assertEqual(dict(row), {"outcome": "success", "label_source": "user_confirmed"})

    def test_ingest_event_records_file_paths(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            self.run_store(
                "ingest-event",
                "--project-dir",
                str(ROOT),
                "--payload-json",
                json.dumps(
                    {
                        "sessionKey": "file-session",
                        "projectDir": str(ROOT),
                        "eventType": "file.edited",
                        "filesTouched": ["src/example.ts"],
                        "raw": {"path": "src/example.ts"},
                    }
                ),
                home=home,
            )

            conn = sqlite3.connect(home / "traces.sqlite")
            row = conn.execute("SELECT path FROM files_touched").fetchone()
            self.assertEqual(row[0], "src/example.ts")

    def test_infer_stale_only_updates_unanswered_pending_records(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            old_payload = {
                "sessionKey": "old-session",
                "projectDir": str(ROOT),
                "createdAt": "2026-06-28T12:00:00Z",
                "triggerType": "git_commit",
                "triggerCommand": "git commit -m fix",
                "outcome": "awaiting_label",
                "labelSource": "pending_user",
            }
            new_payload = {
                **old_payload,
                "sessionKey": "new-session",
                "createdAt": "2999-01-01T00:00:00Z",
            }

            for payload in (old_payload, new_payload):
                self.run_store(
                    "record-terminal",
                    "--project-dir",
                    str(ROOT),
                    "--payload-json",
                    json.dumps(payload),
                    home=home,
                )

            result = json.loads(
                self.run_store("infer-stale", "--older-than-hours", "1", home=home)
            )
            self.assertEqual(len(result["updated"]), 1)
            self.assertEqual(result["updated"][0]["session_key"], "old-session")

            conn = sqlite3.connect(home / "traces.sqlite")
            conn.row_factory = sqlite3.Row
            rows = {
                row["session_key"]: dict(row)
                for row in conn.execute(
                    "SELECT session_key, outcome, label_source FROM terminal_records"
                )
            }
            self.assertEqual(rows["old-session"]["outcome"], "partial")
            self.assertEqual(rows["old-session"]["label_source"], "inferred_no_user_response")
            self.assertEqual(rows["new-session"]["outcome"], "awaiting_label")
            self.assertEqual(rows["new-session"]["label_source"], "pending_user")

    def test_record_terminal_is_idempotent_for_same_trigger_command(self):
        with tempfile.TemporaryDirectory() as tmp:
            home = Path(tmp)
            payload = {
                "sessionKey": "dup-session",
                "projectDir": str(ROOT),
                "createdAt": "2026-06-29T12:00:00Z",
                "triggerType": "git_commit",
                "triggerCommand": "git commit -m fix",
                "outcome": "awaiting_label",
                "labelSource": "pending_user",
            }

            for _ in range(3):
                self.run_store(
                    "record-terminal",
                    "--project-dir",
                    str(ROOT),
                    "--payload-json",
                    json.dumps(payload),
                    home=home,
                )

            conn = sqlite3.connect(home / "traces.sqlite")
            count = conn.execute("SELECT count(*) FROM terminal_records").fetchone()[0]
            self.assertEqual(count, 1)


if __name__ == "__main__":
    unittest.main()
