// B43.16 — main went red when Maven Central stalled mid-download ("Read timed out" on react-android's aar, after
// Gradle's 30s socket timeout and 3 tries). Give dependency downloads a longer timeout and more, slower retries.
const { withGradleProperties } = require('expo/config-plugins')

const props = {
  'systemProp.org.gradle.internal.http.connectionTimeout': '120000',
  'systemProp.org.gradle.internal.http.socketTimeout': '120000',
  'systemProp.org.gradle.internal.repository.max.retries': '6',
  'systemProp.org.gradle.internal.repository.initial.backoff': '2000',
}

module.exports = (config) =>
  withGradleProperties(config, (c) => {
    c.modResults = c.modResults.filter((p) => !(p.type === 'property' && p.key in props))
    for (const [key, value] of Object.entries(props)) c.modResults.push({ type: 'property', key, value })
    return c
  })
