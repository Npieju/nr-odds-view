CREATE TABLE race_history (
  race_id TEXT PRIMARY KEY NOT NULL,
  meeting_date TEXT NOT NULL,
  venue TEXT NOT NULL,
  race_number INTEGER NOT NULL,
  race_label TEXT NOT NULL,
  close_ms INTEGER NOT NULL,
  last_received_ms INTEGER NOT NULL,
  payload TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX race_history_by_day ON race_history(meeting_date, close_ms);
