-- Runs once, when the Postgres volume is first created.
-- A separate database for automated tests, so tests never touch demo data.
CREATE DATABASE certiflow_test;
