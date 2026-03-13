#!/usr/bin/env node
/**
 * Claim an invite for the CalDAV server via the admin API.
 *
 * Usage:
 *   node scripts/claim-invite.mjs <invite-url>
 *   node scripts/claim-invite.mjs <docId> <payload>
 *
 * The server must be running. Defaults to http://localhost:3000.
 * Set DRIVE_URL to override.
 */

const baseUrl = process.env.DRIVE_URL || 'http://localhost:3000';

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
  console.log('Usage:');
  console.log('  node scripts/claim-invite.mjs <invite-url>');
  console.log('  node scripts/claim-invite.mjs <docId> <payload>');
  console.log('');
  console.log('Environment:');
  console.log('  DRIVE_URL  Server URL (default: http://localhost:3000)');
  process.exit(args.length === 0 ? 1 : 0);
}

let body;
if (args.length === 1) {
  // Full invite URL
  body = { invitePayload: args[0] };
} else {
  // docId + payload
  body = { docId: args[0], invitePayload: args[1] };
}

try {
  const resp = await fetch(`${baseUrl}/admin/caldav-claim-invite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  if (resp.ok) {
    console.log('Invite claimed successfully!');
    console.log('  docId:', data.docId);
    console.log('  khDocId:', data.khDocId);
  } else {
    console.error('Error:', data.error);
    process.exit(1);
  }
} catch (err) {
  console.error('Failed to connect to server:', err.message);
  console.error('Is the server running at', baseUrl, '?');
  process.exit(1);
}
