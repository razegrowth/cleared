import { useState } from 'react';
import { initials } from '../shared/format';
import type { Person } from '../shared/types';

/**
 * Senders: initials in a quiet ring. Accounts (`tint` given): a rounded
 * square in full colour, their photo or their colour behind their initials,
 * so each inbox is told apart at a glance.
 */
export function Avatar({
  person,
  picture,
  size,
  tint,
}: {
  person: Pick<Person, 'name' | 'email'>;
  picture?: string;
  size?: 'xs' | 'sm' | 'md';
  tint?: string;
}) {
  const [broken, setBroken] = useState(false);
  return (
    <span
      className={`avatar ${size ?? ''} ${tint ? 'account' : ''}`}
      style={tint ? ({ '--tint': tint } as React.CSSProperties) : undefined}
      aria-hidden
    >
      {picture && !broken ? (
        <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        // The smallest size has room for one letter.
        size === 'xs' ? initials(person).slice(0, 1) : initials(person)
      )}
    </span>
  );
}
