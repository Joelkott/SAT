'use client';

import { useEffect, useState } from 'react';

// Signed-in team role helpers. The guest account is view-only: the backend
// enforces that (every non-GET request from a guest is refused with 403), so
// these helpers only hide controls so a guest never runs into those errors.

export type Role = 'admin' | 'media' | 'worship' | 'guest' | '';

const ROLES: Role[] = ['admin', 'media', 'worship', 'guest'];

export function getRole(): Role {
  if (typeof window === 'undefined') return '';
  const r = localStorage.getItem('sat-role') as Role | null;
  return r && ROLES.includes(r) ? r : '';
}

// For callbacks/effects that may run before useRole() state has settled.
export function isGuest(): boolean {
  return getRole() === 'guest';
}

export function useRole(): Role {
  const [role, setRole] = useState<Role>('');
  useEffect(() => setRole(getRole()), []);
  return role;
}
