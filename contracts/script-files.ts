// What a cron script's file name may be (M3 #12): a flat file name in a profile's `scripts/` folder, never a path. The script editor checks it before it is sent,
// and the Caduceus route that saves the script checks it again; both read it from here.

/** Letters, digits, dots, dashes and underscores, not starting with a dot (so never `.`, `..` or a hidden file), at most 100 characters. */
export const SCRIPT_FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,99}$/;

/** The most a script may hold, in bytes: a script is a few lines, and what a megabyte of it would do is not what the editor is for. */
export const MAX_SCRIPT_BYTES = 256_000;
