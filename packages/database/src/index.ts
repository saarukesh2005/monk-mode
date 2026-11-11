// Migration registry. Both the desktop (Rust include_str!) and Android (assets) apps load the
// same files in this order; PRAGMA user_version stores the number of applied migrations.
export const MIGRATIONS = ['0001_init.sql', '0002_mindful_pause.sql'] as const;
export const SCHEMA_VERSION = MIGRATIONS.length;
