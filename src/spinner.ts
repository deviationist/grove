import chalk from 'chalk';

const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const isTTY = !!process.stderr.isTTY;

export interface Spinner {
  update(msg: string): void;
  stop(): void;
}

export function startSpinner(msg: string): Spinner {
  if (!isTTY) return { update() {}, stop() {} };

  let current = msg;
  let frame = 0;
  const iv = setInterval(() => {
    process.stderr.write(`\r${chalk.cyan(FRAMES[frame++ % FRAMES.length])} ${current}`);
  }, 80);

  return {
    update(newMsg: string) { current = newMsg; },
    stop() {
      clearInterval(iv);
      process.stderr.write('\r\x1b[K');
    },
  };
}
