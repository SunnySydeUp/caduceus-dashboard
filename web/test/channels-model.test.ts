import { describe, expect, test } from 'vitest';
import { behaviourSections, behaviourUpdate, behaviourHelp, changedBehaviour, channelStatus, channelTestPath, channelUpdate, enableBlocker, filterChannels, groupChannels, orderChannels, parseChannels, readSaveAnswer, readTestAnswer, testResultFor, validateChannelForm, type Channel } from '../src/modules/channels/channels-model.ts';

const field = (key: string, extra: Record<string, unknown> = {}) => ({
  key,
  required: false,
  is_set: false,
  redacted_value: null,
  description: '',
  prompt: key,
  help: '',
  url: null,
  is_password: false,
  advanced: false,
  ...extra,
});

const platform = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: id[0].toUpperCase() + id.slice(1),
  description: `${id} words`,
  docs_url: `https://docs.example/${id}`,
  enabled: false,
  configured: false,
  gateway_running: true,
  state: 'disabled',
  error_code: null,
  error_message: null,
  updated_at: null,
  home_channel: null,
  env_vars: [],
  ingress_url: null,
  ...extra,
});

describe('reading Hermes’s list of platforms', () => {
  test('a platform becomes a card with its fields; a field Hermes says is a password is a secret, and what Hermes redacted is all the page has of it', () => {
    const { channels, startCommand } = parseChannels({
      env_path: '/home/.env',
      gateway_start_command: 'hermes gateway start',
      platforms: [
        platform('telegram', {
          name: 'Telegram',
          enabled: true,
          configured: true,
          state: 'connected',
          home_channel: { chat_id: '42', name: 'Me' },
          env_vars: [
            field('TELEGRAM_BOT_TOKEN', { required: true, is_set: true, redacted_value: '1234...6789', is_password: true, prompt: 'Telegram bot token', description: 'Token from @BotFather', url: 'https://t.me/BotFather' }),
            field('TELEGRAM_ALLOWED_USERS', { is_set: true, redacted_value: '***', prompt: 'Allowed users', advanced: true }),
          ],
        }),
      ],
    });

    expect(startCommand).toBe('hermes gateway start');
    expect(channels).toEqual([
      {
        id: 'telegram',
        name: 'Telegram',
        description: 'telegram words',
        docsUrl: 'https://docs.example/telegram',
        enabled: true,
        configured: true,
        gatewayRunning: true,
        state: 'connected',
        error: undefined,
        homeChannel: 'Me',
        ingressUrl: undefined,
        fields: [
          { key: 'TELEGRAM_BOT_TOKEN', label: 'Telegram bot token', description: 'Token from @BotFather', url: 'https://t.me/BotFather', required: true, secret: true, isSet: true, redacted: '1234...6789', advanced: false },
          { key: 'TELEGRAM_ALLOWED_USERS', label: 'Allowed users', description: '', url: undefined, required: false, secret: false, isSet: true, redacted: '***', advanced: true },
        ],
      },
    ]);
  });

  test('an answer that is not a list of platforms is no channels at all', () => {
    expect(parseChannels({ detail: 'nope' }).channels).toEqual([]);
    expect(parseChannels(undefined).channels).toEqual([]);
    expect(parseChannels({ platforms: [{ name: 'no id' }, 7] }).channels).toEqual([]);
  });
});

describe('a channel’s status', () => {
  const status = (state: string, extra: Record<string, unknown> = {}) => channelStatus(parseChannels({ platforms: [platform('x', { state, enabled: state !== 'disabled', configured: state !== 'not_configured' && state !== 'disabled', ...extra })] }).channels[0]);

  test('says each state Hermes reports in words, with a tone, and whether the card’s main action is Configure', () => {
    expect([
      status('connected'),
      status('disabled'),
      status('not_configured'),
      status('pending_restart'),
      status('gateway_stopped'),
      status('startup_failed'),
      status('fatal', { error_message: 'Bad token' }),
      status('retrying'),
      status('something_new'),
    ]).toEqual([
      { label: 'Connected', tone: 'success', badge: 'online', setup: false },
      { label: 'Disabled', tone: 'neutral', badge: 'offline', setup: true },
      { label: 'Not set up', tone: 'neutral', badge: 'offline', setup: true },
      { label: 'Waiting for a gateway restart', tone: 'warning', badge: 'degraded', setup: false },
      { label: 'Gateway stopped', tone: 'warning', badge: 'degraded', setup: false },
      { label: 'Failed to start', tone: 'danger', badge: 'failed', setup: false },
      { label: 'Failed', tone: 'danger', badge: 'failed', setup: false },
      { label: 'Reconnecting', tone: 'warning', badge: 'reconnecting', setup: false },
      { label: 'Something new', tone: 'neutral', badge: 'offline', setup: false },
    ]);
  });

  test('a platform that is neither set up nor enabled offers Configure first: a disabled one with nothing configured too', () => {
    expect(status('disabled', { configured: false }).setup).toBe(true);
    expect(status('disabled', { configured: true }).setup).toBe(false);
  });
});

describe('the list on the page', () => {
  const channels: Channel[] = ['slack', 'discord', 'telegram', 'matrix'].map((id, index) =>
    parseChannels({ platforms: [platform(id, { name: id, state: ['connected', 'not_configured', 'connected', 'disabled'][index], enabled: index !== 3 && index !== 1, configured: index !== 1, description: index === 2 ? 'Run Hermes from DMs' : 'x' })] }).channels[0],
  );

  test('lists the channels that are set up first, by name, then the rest by name', () => {
    expect(orderChannels(channels).map((channel) => channel.id)).toEqual(['slack', 'telegram', 'discord', 'matrix']);
  });

  test('a search matches the name, the id and the description, and the filters keep the connected ones, the set-up ones or the others', () => {
    expect(filterChannels(channels, { query: 'dms', show: 'all' }).map((channel) => channel.id)).toEqual(['telegram']);
    expect(filterChannels(channels, { query: 'MATR', show: 'all' }).map((channel) => channel.id)).toEqual(['matrix']);
    expect(filterChannels(channels, { query: '', show: 'active' }).map((channel) => channel.id)).toEqual(['slack', 'telegram']);
    expect(filterChannels(channels, { query: '', show: 'inactive' }).map((channel) => channel.id)).toEqual(['discord', 'matrix']);
  });
});

describe('checking a channel’s form before it is saved', () => {
  const telegram = parseChannels({
    platforms: [
      platform('telegram', {
        env_vars: [
          field('TELEGRAM_BOT_TOKEN', { required: true, is_password: true, prompt: 'Telegram bot token' }),
          field('TELEGRAM_ALLOWED_USERS', { prompt: 'Allowed Telegram user IDs' }),
          field('TELEGRAM_PROXY', { prompt: 'Proxy URL' }),
        ],
      }),
    ],
  }).channels[0];
  const token = '123456789:ABCdefGHIjklMNOpqrSTUvwxYZ0123456789';

  test('a required field with no value, and none stored, is a problem named after the field', () => {
    expect(validateChannelForm(telegram, {})).toEqual({ TELEGRAM_BOT_TOKEN: 'Telegram bot token is required.' });
  });

  test('a required field Hermes already holds a value for may be left empty, but not cleared', () => {
    const stored = { ...telegram, fields: telegram.fields.map((f) => (f.key === 'TELEGRAM_BOT_TOKEN' ? { ...f, isSet: true, redacted: '1234...6789' } : f)) };
    expect(validateChannelForm(stored, {})).toEqual({});
    expect(validateChannelForm(stored, {}, { clear: ['TELEGRAM_BOT_TOKEN'] })).toEqual({ TELEGRAM_BOT_TOKEN: 'Telegram bot token is required, so it cannot be removed.' });
  });

  test('applies Hermes’s own shape rules for the platform’s fields, with Hermes’s words', () => {
    expect(validateChannelForm(telegram, { TELEGRAM_BOT_TOKEN: 'nope' })).toEqual({ TELEGRAM_BOT_TOKEN: 'Telegram bot token must be the complete token from @BotFather, such as 123456789:ABC…' });
    expect(validateChannelForm(telegram, { TELEGRAM_BOT_TOKEN: token, TELEGRAM_ALLOWED_USERS: '12, x' })).toEqual({ TELEGRAM_ALLOWED_USERS: 'Telegram allowed users must be comma-separated numeric user IDs.' });
    expect(validateChannelForm(telegram, { TELEGRAM_BOT_TOKEN: token, TELEGRAM_ALLOWED_USERS: '12, 34,' })).toEqual({});
    const slack = parseChannels({ platforms: [platform('slack', { env_vars: [field('SLACK_BOT_TOKEN', { prompt: 'Slack bot token' }), field('SLACK_APP_TOKEN'), field('SLACK_ALLOWED_USERS')] })] }).channels[0];
    expect(validateChannelForm(slack, { SLACK_BOT_TOKEN: 'xapp-1', SLACK_APP_TOKEN: 'xoxb-1', SLACK_ALLOWED_USERS: 'U01ABC2DEF3, *, nobody' })).toEqual({
      SLACK_BOT_TOKEN: 'Slack Bot Token must start with xoxb-. Paste the bot token from OAuth & Permissions.',
      SLACK_APP_TOKEN: 'Slack App Token must start with xapp-. Paste the app-level token from Basic Information > App-Level Tokens.',
      SLACK_ALLOWED_USERS: 'Slack allowed user IDs must be comma-separated member IDs like U01ABC2DEF3.',
    });
  });

  test('a field that is an address must be a web address, and a value that is only spaces counts as empty', () => {
    const mattermost = parseChannels({ platforms: [platform('mattermost', { env_vars: [field('MATTERMOST_URL', { required: true, prompt: 'Server URL' }), field('MATTERMOST_TOKEN', { required: true, is_password: true, prompt: 'Token' })] })] }).channels[0];
    expect(validateChannelForm(mattermost, { MATTERMOST_URL: 'chat.example.com', MATTERMOST_TOKEN: 'x' })).toEqual({ MATTERMOST_URL: 'Server URL must be a web address that starts with http:// or https://.' });
    expect(validateChannelForm(mattermost, { MATTERMOST_URL: 'https://chat.example.com', MATTERMOST_TOKEN: 'x' })).toEqual({});
    expect(validateChannelForm(telegram, { TELEGRAM_BOT_TOKEN: '   ' })).toEqual({ TELEGRAM_BOT_TOKEN: 'Telegram bot token is required.' });
  });
});

describe('what is sent to Hermes to save a channel', () => {
  test('names the platform and the profile, sends only what was typed (trimmed) and what was cleared, and the enabled flag only when it changes', () => {
    expect(channelUpdate('telegram', 'coder', { values: { TELEGRAM_BOT_TOKEN: ' tok ', TELEGRAM_ALLOWED_USERS: '  ', TELEGRAM_PROXY: 'http://p' }, clear: ['TELEGRAM_PROXY', 'TELEGRAM_OLD'] })).toEqual({
      method: 'PUT',
      path: '/api/messaging/platforms/telegram?profile=coder',
      body: { env: { TELEGRAM_BOT_TOKEN: 'tok', TELEGRAM_PROXY: 'http://p' }, clear_env: ['TELEGRAM_OLD'] },
    });
    expect(channelUpdate('google_chat', 'default', { enabled: false })).toEqual({ method: 'PUT', path: '/api/messaging/platforms/google_chat?profile=default', body: { enabled: false, env: {}, clear_env: [] } });
  });

  test('the test is a POST to the platform’s own test route for the profile', () => {
    expect(channelTestPath('slack', 'my profile')).toBe('/api/messaging/platforms/slack/test?profile=my%20profile');
  });
});

describe('what Hermes answers to a save and a test', () => {
  test('a save needs a gateway restart unless Hermes says a live multiplexer took it up at once', () => {
    expect(readSaveAnswer({ ok: true, platform: 'telegram', hot_served: false })).toEqual({ needsRestart: true });
    expect(readSaveAnswer({ ok: true, platform: 'telegram', hot_served: true })).toEqual({ needsRestart: false });
    expect(readSaveAnswer(undefined)).toEqual({ needsRestart: true });
  });

  test('a test reports Hermes’s own message and whether it passed', () => {
    expect(readTestAnswer({ ok: true, state: 'connected', message: 'Telegram is connected.' })).toEqual({ ok: true, message: 'Telegram is connected.' });
    expect(readTestAnswer({ ok: false, state: 'disabled', message: 'Telegram is disabled. Enable it, then restart the gateway.' })).toEqual({ ok: false, message: 'Telegram is disabled. Enable it, then restart the gateway.' });
    expect(readTestAnswer('<html>')).toEqual({ ok: false, message: 'Hermes did not say how the test went.' });
  });
});

describe('a channel’s behaviour settings', () => {
  const schema = {
    category_order: [],
    fields: {
      'discord.auto_thread': { type: 'boolean', description: 'Discord → Auto Thread', category: 'discord' },
      'discord.history_backfill_limit': { type: 'number', description: 'Discord → History Backfill Limit', category: 'discord' },
      'discord.allowed_channels': { type: 'string', description: 'Discord → Allowed Channels', category: 'discord' },
      'discord.missed_message_backfill.enabled': { type: 'boolean', description: 'Discord → Missed Message Backfill → Enabled', category: 'discord' },
      'discord.voice_fx.ack_phrases': { type: 'list', description: 'Discord → Voice Fx → Ack Phrases', category: 'discord' },
      'discord.channel_prompts': { type: 'object', description: 'Discord → Channel Prompts', category: 'discord' },
      'display.platforms.discord.streaming': { type: 'boolean', description: 'Display → Platforms → Discord → Streaming', category: 'display' },
      'display.platforms.slack.streaming': { type: 'boolean', description: 'Display → Platforms → Slack → Streaming', category: 'display' },
      'slack.require_mention': { type: 'boolean', description: 'Slack → Require Mention', category: 'slack' },
      'streaming.enabled': { type: 'boolean', description: 'Streaming → Enabled', category: 'streaming' },
      'streaming.edit_interval': { type: 'number', description: 'Streaming → Edit Interval', category: 'streaming' },
      'human_delay.mode': { type: 'select', description: 'Simulated typing delay mode', category: 'display', options: ['off', 'typing', 'fixed'] },
      'agent.max_turns': { type: 'number', description: 'Agent → Max Turns', category: 'agent' },
    },
  };
  const config = {
    discord: { auto_thread: true, history_backfill_limit: 50, allowed_channels: '', missed_message_backfill: { enabled: false }, voice_fx: { ack_phrases: ['ok', 'got it'] }, channel_prompts: {} },
    streaming: { enabled: false, edit_interval: 0.8 },
    human_delay: { mode: 'off' },
    agent: { max_turns: 90 },
  };

  test('takes the platform’s own keys and its display keys, then the settings every channel shares, each with the type the schema gives it and the value the config holds', () => {
    const sections = behaviourSections(schema, config, 'discord');

    expect(sections.map((section) => [section.id, section.fields.map((field) => [field.key, field.kind, field.label, field.value])])).toEqual([
      [
        'channel',
        [
          ['discord.auto_thread', 'boolean', 'Auto thread', true],
          ['discord.history_backfill_limit', 'number', 'History backfill limit', 50],
          ['discord.allowed_channels', 'string', 'Allowed channels', ''],
          ['discord.missed_message_backfill.enabled', 'boolean', 'Missed message backfill › Enabled', false],
          ['discord.voice_fx.ack_phrases', 'list', 'Voice fx › Ack phrases', ['ok', 'got it']],
        ],
      ],
      ['display', [['display.platforms.discord.streaming', 'boolean', 'Streaming', undefined]]],
      [
        'shared',
        [
          ['streaming.enabled', 'boolean', 'Streaming › Enabled', false],
          ['streaming.edit_interval', 'number', 'Streaming › Edit interval', 0.8],
          ['human_delay.mode', 'select', 'Human delay › Mode', 'off'],
        ],
      ],
    ]);
    expect(sections[2].fields[2].options).toEqual(['off', 'typing', 'fixed']);
  });

  test('a channel with no settings of its own still has the shared ones, and another channel’s keys never show', () => {
    const sections = behaviourSections(schema, config, 'matrix');
    expect(sections.map((section) => section.id)).toEqual(['shared']);
    expect(behaviourSections(schema, config, 'slack').flatMap((section) => section.fields.map((field) => field.key)).filter((key) => key.includes('discord'))).toEqual([]);
  });

  test('an answer that is not a schema gives no sections', () => {
    expect(behaviourSections(undefined, config, 'discord')).toEqual([]);
  });

  test('only what differs from the config is a change, and a change is written as the nested config Hermes merges', () => {
    const [channel] = behaviourSections(schema, config, 'discord');
    const draft = { 'discord.auto_thread': false, 'discord.history_backfill_limit': 50, 'discord.missed_message_backfill.enabled': true, 'discord.voice_fx.ack_phrases': ['ok', 'got it'] };

    const changes = changedBehaviour(channel.fields, draft);

    expect(changes).toEqual({ 'discord.auto_thread': false, 'discord.missed_message_backfill.enabled': true });
    expect(behaviourUpdate('coder', changes)).toEqual({
      method: 'PUT',
      path: '/api/config?profile=coder',
      body: { config: { discord: { auto_thread: false, missed_message_backfill: { enabled: true } } } },
    });
  });

  test('a number that is not a number is no change; a list is compared by what it holds', () => {
    const [channel] = behaviourSections(schema, config, 'discord');
    expect(changedBehaviour(channel.fields, { 'discord.history_backfill_limit': Number.NaN })).toEqual({});
    expect(changedBehaviour(channel.fields, { 'discord.voice_fx.ack_phrases': ['ok'] })).toEqual({ 'discord.voice_fx.ack_phrases': ['ok'] });
  });
});

describe('finding the common chat apps on the list', () => {
  const list = (...ids: string[]) => ids.map((id) => parseChannels({ platforms: [platform(id)] }).channels[0]);

  test('puts Telegram, Discord, Slack, WhatsApp and Email first in that order, and the other platforms in a group after them', () => {
    const groups = groupChannels(list('a2a', 'api_server', 'slack', 'matrix', 'telegram', 'email', 'discord', 'whatsapp'));

    expect(groups.map((group) => [group.id, group.channels.map((channel) => channel.id)])).toEqual([
      ['common', ['telegram', 'discord', 'slack', 'whatsapp', 'email']],
      ['other', ['a2a', 'api_server', 'matrix']],
    ]);
  });

  test('leaves out a group with nothing in it', () => {
    expect(groupChannels(list('matrix')).map((group) => group.id)).toEqual(['other']);
    expect(groupChannels(list('slack')).map((group) => group.id)).toEqual(['common']);
    expect(groupChannels([])).toEqual([]);
  });
});

describe('why a channel cannot be switched on yet', () => {
  const telegram = (extra: Record<string, unknown>, fields: Record<string, unknown>[] = []) => parseChannels({ platforms: [platform('telegram', { name: 'Telegram', env_vars: fields, ...extra })] }).channels[0];

  test('names the first required value that is missing, or says to set the channel up', () => {
    const token = field('TELEGRAM_BOT_TOKEN', { required: true, prompt: 'Telegram bot token' });

    expect(enableBlocker(telegram({}, [field('TELEGRAM_ALLOWED_USERS'), token]))).toBe('Add the telegram bot token first');
    expect(enableBlocker(telegram({}))).toBe('Set up Telegram first');
  });

  test('says nothing once the channel is set up or already on, so it can be switched', () => {
    expect(enableBlocker(telegram({ configured: true }))).toBeUndefined();
    expect(enableBlocker(telegram({ enabled: true }))).toBeUndefined();
  });

  test('a test of a channel that is not set up says to set it up first, not to enable it, which the switch would refuse', () => {
    const disabled = { ok: false, message: 'Telegram is disabled. Enable it, then restart the gateway.' };

    expect(testResultFor(telegram({}), disabled)).toEqual({ ok: false, message: 'Telegram is not set up yet. Set it up first, then enable it and restart the gateway.' });
    expect(testResultFor(telegram({ configured: true }), disabled)).toEqual(disabled);
    expect(testResultFor(telegram({}), { ok: true, message: 'fine' })).toEqual({ ok: true, message: 'fine' });
  });
});

describe('help for a behaviour key', () => {
  test('says one line for the keys owners meet, by the key or its last word, and nothing for a key it does not know', () => {
    expect(behaviourHelp('streaming.buffer_threshold')).toMatch(/characters/);
    expect(behaviourHelp('discord.auto_thread')).toMatch(/thread/);
    expect(behaviourHelp('telegram.extra.allow_cjk_rich_messages')).toMatch(/Chinese, Japanese and Korean/);
    expect(behaviourHelp('discord.something_new')).toBeUndefined();
    expect(behaviourSections({ fields: { 'telegram.extra.allow_cjk_rich_messages': { type: 'boolean' } } }, {}, 'telegram')[0].fields[0].label).toBe('Extra › Allow CJK rich messages');
  });
});
