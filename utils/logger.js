const chalk = require('chalk');
const fs = require('fs');
const path = require('path');

const logsDir = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logFile = path.join(logsDir, `helpy-${new Date().toISOString().split('T')[0]}.log`);

const write = (level, ...args) => {
  const time = new Date().toLocaleString('fr-FR');
  const msg = `[${time}] [${level}] ${args.join(' ')}`;
  fs.appendFileSync(logFile, msg + '\n');
};

module.exports = {
  info: (...args) => { console.log(chalk.blue('[INFO]'), ...args); write('INFO', ...args); },
  success: (...args) => { console.log(chalk.green('[OK]'), ...args); write('OK', ...args); },
  warn: (...args) => { console.log(chalk.yellow('[WARN]'), ...args); write('WARN', ...args); },
  error: (...args) => { console.log(chalk.red('[ERR]'), ...args); write('ERR', ...args); },
};
