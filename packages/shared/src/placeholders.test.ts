import { describe, expect, test } from 'bun:test';
import { findUnknownPlaceholders, renderPlaceholders, tokenizePlaceholders } from './placeholders';

const known = ['user', 'username', 'server', 'memberCount'] as const;

describe('renderPlaceholders', () => {
  test('replaces every known placeholder', () => {
    expect(
      renderPlaceholders('Hi {user}, welcome to {server}! You are #{memberCount}.', {
        user: '<@1>',
        server: 'Shifu Dojo',
        memberCount: 42,
      }),
    ).toBe('Hi <@1>, welcome to Shifu Dojo! You are #42.');
  });

  test('replaces repeated placeholders', () => {
    expect(renderPlaceholders('{username} {username}', { username: 'mei' })).toBe('mei mei');
  });

  test('keeps unknown placeholders untouched', () => {
    expect(renderPlaceholders('Hello {nope}', { user: 'x' })).toBe('Hello {nope}');
  });

  test('ignores braces that are not placeholders', () => {
    expect(renderPlaceholders('{ user } {} {1abc}', { user: 'x' })).toBe('{ user } {} {1abc}');
  });

  test('does not read inherited object properties', () => {
    expect(renderPlaceholders('{toString}', {})).toBe('{toString}');
  });

  test('does not re-expand placeholders inside values', () => {
    expect(renderPlaceholders('{username}', { username: '{server}', server: 'x' })).toBe('{server}');
  });
});

describe('tokenizePlaceholders', () => {
  test('splits text and placeholders and flags unknown ones', () => {
    expect(tokenizePlaceholders('Hi {user} from {planet}!', known)).toEqual([
      { type: 'text', value: 'Hi ' },
      { type: 'placeholder', name: 'user', raw: '{user}', known: true },
      { type: 'text', value: ' from ' },
      { type: 'placeholder', name: 'planet', raw: '{planet}', known: false },
      { type: 'text', value: '!' },
    ]);
  });

  test('handles an empty string', () => {
    expect(tokenizePlaceholders('', known)).toEqual([]);
  });

  test('lists unknown placeholders once', () => {
    expect(findUnknownPlaceholders('{a} {user} {a} {b}', known)).toEqual(['a', 'b']);
  });
});
