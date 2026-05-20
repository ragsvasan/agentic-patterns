/**
 * TEMPLATE — copy to your project as tests/qa/run.ts
 * Set env vars and point at your project's fixtures.
 *
 * Run with:
 *   QA_SERVER_URL=https://staging.example.com \
 *   QA_TEST_USER_ID=test-user-001 \
 *   QA_API_KEY=sk-test-... \
 *   npx tsx tests/qa/run.ts
 */

import { QARunner, printReport, buildSynthesisPrompt } from 'agentic-patterns/qa-framework';
import { SCENARIOS } from './fixtures/scenarios.js';
import { PROBES } from './fixtures/probes.js';

const config = {
	serverUrl: process.env.QA_SERVER_URL ?? 'http://localhost:3000',
	testUserId: process.env.QA_TEST_USER_ID ?? 'test-user-001',
	apiKey: process.env.QA_API_KEY ?? '',
	resetState: async (userId: string) => {
		// Replace with your project's state reset mechanism.
		// Options:
		//   1. Call a /test/reset admin endpoint
		//   2. Run a DB migration/truncate against the test DB
		//   3. Delete via a bulk-delete tool if one exists
		const res = await fetch(`${config.serverUrl}/api/test/reset`, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${config.apiKey}`,
				'Content-Type': 'application/json',
			},
			body: JSON.stringify({ userId }),
		});
		if (!res.ok) throw new Error(`State reset failed: ${res.status}`);
	},
};

const runner = new QARunner(config);
const report = await runner.run(SCENARIOS, PROBES);

printReport(report);

// Optional: print the synthesis prompt to feed to Claude for adversarial analysis
const coverageTable = `
| Entity type | create | read | summary | analytics |
|---|---|---|---|---|
| TYPE_A | ✓ | ✓ | ✓ | ✓ |
| TYPE_B | ✓ | ✓ | — | — |
`;

console.log('\n── Synthesis Prompt (feed to Claude) ──────────────────────\n');
console.log(buildSynthesisPrompt(report, coverageTable));
