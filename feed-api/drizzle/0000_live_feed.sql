CREATE TABLE live_feed (id INTEGER PRIMARY KEY CHECK (id = 1), generated_ms INTEGER NOT NULL, payload TEXT NOT NULL);
