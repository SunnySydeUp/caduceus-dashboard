import { describe, expect, test } from 'vitest';
import { groupHookEvents } from '../src/modules/tools/hooks-model.ts';

describe('the events a shell hook can run on', () => {
  test('are listed in groups with plain words, and an event Caduceus has no words for keeps its Hermes name under Other', () => {
    const groups = groupHookEvents(['on_stream_delta', 'pre_tool_call', 'on_session_start', 'pre_api_request', 'post_tool_call', 'pre_gateway_dispatch', 'something_new']);

    expect(groups.map((group) => [group.title, group.events.map((event) => event.id)])).toEqual([
      ['Tools', ['pre_tool_call', 'post_tool_call']],
      ['Sessions and helper agents', ['on_session_start']],
      ['Model requests', ['pre_api_request']],
      ['Replies', ['on_stream_delta']],
      ['Chat messages and approvals', ['pre_gateway_dispatch']],
      ['Other', ['something_new']],
    ]);
    expect(groups[0].events[0].label).toBe('Before a tool runs · pre_tool_call');
    expect(groups.at(-1)?.events[0].label).toBe('something_new');
  });

  test('every event Hermes lists is in exactly one group', () => {
    const events = ['pre_llm_call', 'transform_llm_output', 'on_skill_lifecycle', 'subagent_stop', 'pre_approval_request', 'on_human_input_request', 'pre_auxiliary_call', 'agent_loop_stopped'];

    expect(groupHookEvents(events).flatMap((group) => group.events.map((event) => event.id)).sort()).toEqual([...events].sort());
  });
});
