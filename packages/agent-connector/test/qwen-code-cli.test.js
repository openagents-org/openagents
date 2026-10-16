'use strict';

const { it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const QwenCodeAdapter = require('../src/adapters/qwen-code');

// Optional real-CLI regression: no external endpoint or paid key is used.
const cli = process.env.QWEN_CODE_TEST_CLI;

for (const envKey of ['OPENAI_API_KEY', 'SAVED_PROVIDER_KEY']) {
  it(`uses the agent endpoint and key over an existing provider (${envKey})`, {
    skip: !cli && 'Set QWEN_CODE_TEST_CLI to a Qwen Code executable or JS entry',
    timeout: 30000,
  }, async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'oa-qwen-cli-'));
    const requests = [];
    const server = http.createServer((req, res) => {
      requests.push({ url: req.url, authorization: req.headers.authorization });
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'test rejection', type: 'authentication_error' } }));
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    let adapter;
    try {
      const base = `http://127.0.0.1:${server.address().port}`;
      const qwenHome = path.join(dir, 'home');
      const projectConfig = path.join(dir, '.qwen');
      fs.mkdirSync(qwenHome);
      fs.mkdirSync(projectConfig);
      const saved = JSON.stringify({
        security: { auth: { selectedType: 'openai' } },
        modelProviders: { openai: [{ id: 'review-model', baseUrl: `${base}/saved/v1`, envKey }] },
      });
      const savedFile = path.join(qwenHome, 'settings.json');
      fs.writeFileSync(savedFile, saved);
      fs.writeFileSync(path.join(projectConfig, 'settings.json'), saved);
      const systemFile = path.join(dir, 'system.json');
      const systemSettings = '// machine policy\n' + JSON.stringify({ tools: { exclude: ['web_search'] } });
      fs.writeFileSync(systemFile, systemSettings);
      const defaultsFile = path.join(dir, 'defaults.json');
      fs.writeFileSync(defaultsFile, JSON.stringify({
        memory: { enableManagedAutoMemory: false, enableManagedAutoDream: false },
        general: { enableAutoUpdate: false, disableAutoUpdate: true },
      }));
      adapter = new QwenCodeAdapter({
        workspaceId: 'qwen-cli-test', channelName: 'thread', token: 'unused',
        agentName: path.basename(dir), agentType: 'qwen-code', workingDir: dir,
        agentEnv: {
          ...process.env,
          QWEN_HOME: qwenHome,
          QWEN_CODE_SYSTEM_SETTINGS_PATH: systemFile,
          QWEN_CODE_SYSTEM_DEFAULTS_PATH: defaultsFile,
          SAVED_PROVIDER_KEY: 'saved-provider-test-key',
          LLM_API_KEY: 'agent-test-key', LLM_BASE_URL: `${base}/agent/v1`, LLM_MODEL: 'review-model',
        },
      });
      const errors = [];
      const responses = [];
      let runSettingsPath;
      const writeRunSettings = adapter._writeRunSettings.bind(adapter);
      adapter._writeRunSettings = () => {
        runSettingsPath = writeRunSettings();
        return runSettingsPath;
      };
      adapter._log = () => {};
      adapter._findQwenBinary = () => cli;
      adapter._writeMcpConfig = () => null;
      adapter._writeSystemDefaults = () => defaultsFile;
      adapter.getBrowserEnabled = async () => false;
      adapter.sendStatus = async () => {};
      adapter.sendThinking = async () => {};
      adapter.sendError = async (_channel, text) => { errors.push(text); };
      adapter.sendResponse = async (_channel, text) => { responses.push(text); };
      adapter.client = {
        getSession: async () => ({ title: 'Test', titleManuallySet: true }),
        getRecentMessages: async () => [],
      };
      await adapter._handleMessage({ content: 'Reply OK. Do not use tools.', sessionId: 'thread' });

      assert.deepEqual(requests, [{ url: '/agent/v1/chat/completions', authorization: 'Bearer agent-test-key' }]);
      assert.deepEqual(responses, []);
      assert.equal(errors.length, 1);
      assert.match(errors[0], /rejected the API key/);
      // Qwen itself may migrate the file and add a version stamp.
      const { $version, ...savedSettings } = JSON.parse(fs.readFileSync(savedFile, 'utf8'));
      assert.deepEqual(savedSettings, JSON.parse(saved));
      assert.equal(fs.readFileSync(systemFile, 'utf8'), systemSettings);
      assert.equal(fs.existsSync(runSettingsPath), false);
      assert.equal(fs.existsSync(`${runSettingsPath}.orig`), false);
    } finally {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
      if (adapter && fs.existsSync(adapter._sessionsFile)) fs.unlinkSync(adapter._sessionsFile);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}
