/**
 * Renders a MessagePayload (the exact object the bot sends) the way the Discord
 * client shows it. Supports the markdown subset used in embeds.
 */
import { intToHex, type EmbedData, type MessagePayload } from '@shifubot/shared';
import { Fragment, type ReactNode } from 'react';

interface PreviewProps {
  payload: MessagePayload;
  bot: { username: string; avatarUrl: string };
  /** Display names for mention ids, e.g. { "123": "Mei" }. */
  mentions: Record<string, string>;
  botTag: string;
  timestampLabel: string;
}

const INLINE = /(<@!?\d+>|\*\*[^*]+\*\*|__[^_]+__|\*[^*\n]+\*|_[^_\n]+_|`[^`\n]+`|~~[^~]+~~|https?:\/\/[^\s<]+)/g;

function Mention({ name }: { name: string }) {
  return <span className="rounded-[3px] bg-discord-mention-bg px-0.5 font-medium text-discord-mention">@{name}</span>;
}

export function renderDiscordMarkdown(text: string, mentions: Record<string, string>): ReactNode[] {
  return text.split('\n').map((line, lineIndex, lines) => (
    <Fragment key={lineIndex}>
      {line.split(INLINE).map((part, index) => {
        if (!part) return null;
        const mention = part.match(/^<@!?(\d+)>$/);
        if (mention) return <Mention key={index} name={mentions[mention[1] ?? ''] ?? 'unknown-user'} />;
        if (/^\*\*.+\*\*$/.test(part)) return <strong key={index}>{part.slice(2, -2)}</strong>;
        if (/^__.+__$/.test(part)) return <u key={index}>{part.slice(2, -2)}</u>;
        if (/^~~.+~~$/.test(part)) return <s key={index}>{part.slice(2, -2)}</s>;
        if (/^(\*.+\*|_.+_)$/.test(part)) return <em key={index}>{part.slice(1, -1)}</em>;
        if (/^`.+`$/.test(part))
          return (
            <code key={index} className="rounded bg-discord-code px-1 py-0.5 font-mono text-[0.85em]">
              {part.slice(1, -1)}
            </code>
          );
        if (/^https?:\/\//.test(part))
          return (
            <span key={index} className="text-discord-link hover:underline">
              {part}
            </span>
          );
        return <Fragment key={index}>{part}</Fragment>;
      })}
      {lineIndex < lines.length - 1 && <br />}
    </Fragment>
  ));
}

function Embed({ embed, mentions, timestampLabel }: { embed: EmbedData; mentions: Record<string, string>; timestampLabel: string }) {
  return (
    <div
      className="mt-1 grid max-w-[432px] rounded-[4px] border-l-4 bg-discord-embed"
      style={{ borderLeftColor: intToHex(embed.color) }}
    >
      <div className="grid grid-cols-[1fr_auto] gap-x-3 px-3 pb-4 pt-2 sm:gap-x-4">
        <div className="min-w-0">
          {embed.title && <div className="mt-2 break-words text-base font-semibold leading-snug text-discord-heading">{embed.title}</div>}
          {embed.description && (
            <div className="mt-2 whitespace-pre-wrap break-words text-sm leading-[1.375rem] text-discord-text">
              {renderDiscordMarkdown(embed.description, mentions)}
            </div>
          )}
        </div>
        {embed.thumbnail && (
          <img src={embed.thumbnail.url} alt="" className="mt-2 size-14 rounded-[4px] object-cover sm:size-20" loading="lazy" />
        )}
        {embed.image && (
          <img src={embed.image.url} alt="" className="col-span-2 mt-4 max-h-[300px] w-full rounded-[4px] object-cover" loading="lazy" />
        )}
        {(embed.footer || embed.timestamp) && (
          <div className="col-span-2 mt-2 flex items-center gap-1 text-xs font-medium text-discord-muted">
            {embed.footer && <span className="break-words">{embed.footer.text}</span>}
            {embed.footer && embed.timestamp && <span aria-hidden>•</span>}
            {embed.timestamp && <span>{timestampLabel}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

export function DiscordMessagePreview({ payload, bot, mentions, botTag, timestampLabel }: PreviewProps) {
  return (
    <div className="overflow-hidden rounded-panel bg-discord-bg px-3 py-4 font-sans text-discord-text sm:px-4">
      <div className="flex gap-3 sm:gap-4">
        <img src={bot.avatarUrl} alt="" className="size-9 shrink-0 rounded-full sm:size-10" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium text-discord-heading">{bot.username}</span>
            <span className="rounded-[3px] bg-discord-tag px-1 py-px text-[10px] font-semibold leading-tight text-discord-heading">
              {botTag}
            </span>
            <span className="text-xs text-discord-muted">{timestampLabel}</span>
          </div>
          {payload.content && <div className="text-sm leading-[1.375rem]">{renderDiscordMarkdown(payload.content, mentions)}</div>}
          {payload.embeds.map((embed, index) => (
            <Embed key={index} embed={embed} mentions={mentions} timestampLabel={timestampLabel} />
          ))}
        </div>
      </div>
    </div>
  );
}
