export function buildFreezeSnapshot(petition, person) {
  const latest = Array.isArray(petition?.versions) ? petition.versions[0] : null;
  const source = latest || petition || {};
  return {
    revisionId: latest?.id || null,
    frozenAt: new Date().toISOString(),
    frozenBy: person?.pidHash || 'anonymous',
    title: source.title || petition.title || '',
    summary: source.summary || petition.summary || '',
    body: source.body || petition.body || '',
    evidenceSummary: source.evidenceSummary || petition.evidenceSummary || '',
    evidenceLinks: Array.isArray(source.evidenceLinks) ? source.evidenceLinks : petition.evidenceLinks || [],
    problem: source.problem || petition.problem || '',
    proposedAction: source.proposedAction || petition.proposedAction || '',
    impact: source.impact || petition.impact || '',
    risks: source.risks || petition.risks || '',
    implementationPlan: source.implementationPlan || petition.implementationPlan || '',
    topic: source.topic || petition.topic || 'general',
    topicId: source.topicId || petition.topicId || null,
    topicPath: Array.isArray(source.topicPath)
      ? source.topicPath
      : Array.isArray(petition.topicPath)
        ? petition.topicPath
        : [],
  };
}
