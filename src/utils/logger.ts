const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";

export const log = {
  info: (msg: string): void => {
    console.log(msg);
  },
  success: (msg: string): void => {
    console.log(`${GREEN}${msg}${RESET}`);
  },
  error: (msg: string): void => {
    console.error(`${RED}${msg}${RESET}`);
  },
  dim: (msg: string): void => {
    console.log(`${DIM}${msg}${RESET}`);
  },
  bold: (msg: string): void => {
    console.log(`${BOLD}${msg}${RESET}`);
  },
};
