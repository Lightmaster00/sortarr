import { deleteCookie, getCookie, setCookie, type H3Event } from 'h3'
import { SESSION_COOKIE, SESSION_TTL_MS } from './auth'

// Secure seulement si COOKIE_SECURE=true : sur http://192.168.x.x, un cookie Secure serait ignoré.
export function setSessionCookie(event: H3Event, id: string): void {
  setCookie(event, SESSION_COOKIE, id, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE === 'true',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  })
}

export function clearSessionCookie(event: H3Event): void {
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}

export function readSessionId(event: H3Event): string | undefined {
  return getCookie(event, SESSION_COOKIE)
}
