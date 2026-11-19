import { useState } from 'react';
import { initials } from '../shared/format';
import type { Person } from '../shared/types';

/** Initials in a quiet ring, or a photo in greyscale. Never colour. */
export function Avatar({ person, picture, size }: { person: Pick<Person, 'name' | 'email'>; picture?: string; size?: 'sm' | 'md' }) {
  const [broken, setBroken] = useState(false);
  return (
    <span className={`avatar ${size ?? ''}`} aria-hidden>
      {picture && !broken ? (
        <img src={picture} alt="" referrerPolicy="no-referrer" onError={() => setBroken(true)} />
      ) : (
        initials(person)
      )}
    </span>
  );
}
