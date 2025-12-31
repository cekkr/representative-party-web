#!/usr/bin/env node
import { initState } from '../src/infra/persistence/storage.js';
import { describeProfile } from '../src/modules/federation/replication.js';

async function main() {
  try {
    const state = await initState();
    const profile = state.dataConfig || state.settings?.data || {};
    const adapterId = state.store?.adapterId || 'unknown';
    const filename = state.store?.filename || state.store?.kvFile || 'n/a';
    const summary = {
      adapter: adapterId,
      dataProfile: describeProfile(profile),
      mode: profile.mode,
      validation: profile.validationLevel,
      allowPreviews: Boolean(profile.allowPreviews),
      file: filename,
      schemaVersion: state.meta?.schemaVersion,
      counts: {
        ledger: state.uniquenessLedger?.size || 0,
        sessions: state.sessions?.size || 0,
        peers: state.peers?.size || 0,
        discussions: state.discussions?.length || 0,
        petitions: state.petitions?.length || 0,
        votes: state.votes?.length || 0,
        signatures: state.signatures?.length || 0,
        groups: state.groups?.length || 0,
        notifications: state.notifications?.length || 0,
        topics: state.topics?.length || 0,
      },
    };
    console.log(JSON.stringify(summary, null, 2));
    process.exit(0);
  } catch (error) {
    console.error('[db-check] failed:', error);
    process.exit(1);
  }
}

main();
