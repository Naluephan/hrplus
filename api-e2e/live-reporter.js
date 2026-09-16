/**
 * Prints every test the moment it finishes, instead of waiting for its file.
 *
 * Jest's default reporter buffers: with four workers running long suites, the
 * terminal sits quiet for a minute and then prints a wall of results. That is
 * fine for CI and unhelpful when you are watching a run to see whether the
 * thing you just changed passes. This reporter answers one question
 * continuously — what passed, what failed, how far along are we — and leaves
 * the summary at the end to Jest's own reporters.
 *
 * Enable it for one run:
 *   npm run test:api:live
 * or for any run:
 *   npm run test:api -- --reporters=default --reporters=./api-e2e/live-reporter.js
 *
 * Environment:
 *   NO_COLOR=1   plain text, for logs and files
 *   E2E_SLOW_MS  milliseconds above which a passing test is flagged slow (800)
 */
const path = require('path');

const useColour = !process.env.NO_COLOR && process.stdout.isTTY !== false;
const SLOW_MS = Number(process.env.E2E_SLOW_MS ?? 800);

const paint = (code, text) => (useColour ? `[${code}m${text}[0m` : text);
const green = (t) => paint('32', t);
const red = (t) => paint('31', t);
const yellow = (t) => paint('33', t);
const dim = (t) => paint('90', t);
const bold = (t) => paint('1', t);

class LiveReporter {
  constructor(globalConfig) {
    this._globalConfig = globalConfig;
    this._passed = 0;
    this._failed = 0;
    this._skipped = 0;
    this._startedAt = Date.now();
    this._totalFiles = 0;
    this._finishedFiles = 0;
    /** Failures are reprinted together at the end: on a long run the first one
     *  has scrolled away by the time the last one arrives. */
    this._failures = [];
  }

  onRunStart(results, options) {
    this._totalFiles = options.estimatedTime !== undefined ? results.numTotalTestSuites : results.numTotalTestSuites;
    const workers = this._globalConfig.maxWorkers;
    console.log(
      `\n${bold('API e2e')} ${dim(`· ${this._totalFiles} ไฟล์ · ${workers} worker · ผลจะขึ้นทีละเคสทันทีที่เคสนั้นจบ`)}\n`,
    );
  }

  /** Called as each test finishes — this is what makes the output live. */
  onTestCaseResult(test, testCaseResult) {
    const suite = path.basename(test.path).replace('.e2e-spec.ts', '');
    const where = dim(suite.padEnd(20).slice(0, 20));
    const name = [...testCaseResult.ancestorTitles.slice(1), testCaseResult.title].join(' › ');
    const ms = testCaseResult.duration ?? 0;
    const time = ms >= SLOW_MS ? yellow(`${(ms / 1000).toFixed(1)}s`) : dim(`${ms}ms`);

    if (testCaseResult.status === 'passed') {
      this._passed += 1;
      console.log(`${green('✓')} ${where} ${name} ${time}`);
      return;
    }

    if (testCaseResult.status === 'failed') {
      this._failed += 1;
      const reason = firstUsefulLine(testCaseResult.failureMessages);
      this._failures.push({ suite, name, reason });
      console.log(`${red('✗')} ${where} ${bold(name)}`);
      if (reason) console.log(`  ${red('└')} ${reason}`);
      return;
    }

    this._skipped += 1;
    console.log(`${yellow('○')} ${where} ${dim(name)} ${dim(`(${testCaseResult.status})`)}`);
  }

  /** One progress line per file, so a long run shows how much is left. */
  onTestFileResult(test) {
    this._finishedFiles += 1;
    const elapsed = ((Date.now() - this._startedAt) / 1000).toFixed(0);
    console.log(
      dim(
        `   ${this._finishedFiles}/${this._totalFiles} ไฟล์ · ` +
          `ผ่าน ${this._passed} · ล้ม ${this._failed} · ${elapsed}s`,
      ),
    );
  }

  onRunComplete() {
    const seconds = ((Date.now() - this._startedAt) / 1000).toFixed(1);
    const total = this._passed + this._failed + this._skipped;

    if (this._failures.length) {
      console.log(`\n${bold(red(`เคสที่ล้ม ${this._failures.length} เคส`))}`);
      for (const failure of this._failures) {
        console.log(`${red('✗')} ${dim(failure.suite)} ${failure.name}`);
        if (failure.reason) console.log(`  ${dim(failure.reason)}`);
      }
    }

    const headline = this._failed
      ? red(`ล้ม ${this._failed} จาก ${total} เคส`)
      : green(`ผ่านครบ ${this._passed} เคส`);
    console.log(`\n${bold(headline)} ${dim(`· ${seconds}s`)}\n`);
  }
}

/** The assertion line, not the stack trace Jest pads it with. */
function firstUsefulLine(messages = []) {
  const text = messages.join('\n').replace(/\[[0-9;]*m/g, '');
  const line = text
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('at '));
  if (!line) return '';
  return line.length > 160 ? `${line.slice(0, 157)}…` : line;
}

module.exports = LiveReporter;
