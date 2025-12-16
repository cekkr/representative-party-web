// Abstract topic classification hook. Extensions can implement classifyTopic(text, state)
// to return a topic/category string.
export function classifyTopic(text, state) {
  const extensions = state?.extensions?.active || [];
  for (const extension of extensions) {
    if (typeof extension.classifyTopic === 'function') {
      const topic = extension.classifyTopic(text, state);
      if (topic) return String(topic);
    }
  }
  return 'general';
}
