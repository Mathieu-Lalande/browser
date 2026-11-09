package expo.modules.contentblocker

import org.json.JSONArray
import org.json.JSONObject

/**
 * The Android request filter (ADR-051): the index built by `src/shared/blocklist/network.ts`
 * (`network.json`), looked up by host suffix. Port of `matchRequest` there: keep both in step
 * (the shared tests document the behavior).
 */
class NetworkMatcher private constructor(
  private val block: Map<String, List<Entry>>,
  private val allow: Map<String, List<Entry>>,
) {
  /** `party`: 0 both, 1 third-party only, 2 first-party only. */
  class Entry(val path: String, val party: Int, val include: Array<String>, val exclude: Array<String>)

  val size: Int get() = block.values.sumOf { it.size }

  /** Whether a request to `host` + `path` (path and query) made by a page of `pageHost` is blocked. */
  fun blocks(host: String, path: String, pageHost: String): Boolean {
    val thirdParty = pageHost.isEmpty() || approximateSite(host) != approximateSite(pageHost)
    if (!anyApplies(block, host, path, pageHost, thirdParty)) return false
    return !anyApplies(allow, host, path, pageHost, thirdParty)
  }

  private fun anyApplies(map: Map<String, List<Entry>>, host: String, path: String, pageHost: String, thirdParty: Boolean): Boolean {
    var rest = host
    while (true) {
      map[rest]?.let { entries -> if (entries.any { applies(it, path, pageHost, thirdParty) }) return true }
      val dot = rest.indexOf('.')
      if (dot == -1) return false
      rest = rest.substring(dot + 1)
    }
  }

  private fun applies(entry: Entry, path: String, pageHost: String, thirdParty: Boolean): Boolean {
    if (entry.path.isNotEmpty() && !path.startsWith(entry.path)) return false
    if (entry.party == 1 && !thirdParty) return false
    if (entry.party == 2 && thirdParty) return false
    if (entry.include.isNotEmpty() && entry.include.none { hostMatches(pageHost, it) }) return false
    if (entry.exclude.any { hostMatches(pageHost, it) }) return false
    return true
  }

  companion object {
    private val SECOND_LEVEL = setOf("co", "com", "org", "net", "gov", "ac", "edu", "ne", "or", "go", "gouv", "asso")

    fun hostMatches(host: String, domain: String) = host == domain || host.endsWith(".$domain")

    /** Same approximation as `approximateSite` (no public suffix list). */
    fun approximateSite(host: String): String {
      val labels = host.lowercase().trimEnd('.').split('.')
      if (labels.size <= 2 || labels.last().all { it.isDigit() }) return labels.joinToString(".")
      val tld = labels.last()
      val take = if (tld.length == 2 && labels[labels.size - 2] in SECOND_LEVEL) 3 else 2
      return labels.takeLast(take).joinToString(".")
    }

    fun parse(json: String): NetworkMatcher {
      val root = JSONObject(json)
      return NetworkMatcher(group(root.optJSONArray("block")), group(root.optJSONArray("allow")))
    }

    private fun strings(array: JSONArray?): Array<String> = Array(array?.length() ?: 0) { array!!.getString(it) }

    private fun group(entries: JSONArray?): Map<String, List<Entry>> {
      val map = HashMap<String, MutableList<Entry>>(entries?.length() ?: 0)
      if (entries == null) return map
      for (index in 0 until entries.length()) {
        val item = entries.optJSONArray(index) ?: continue
        val host = item.optString(0)
        if (host.isEmpty()) continue
        val entry = Entry(item.optString(1, ""), item.optInt(2, 0), strings(item.optJSONArray(3)), strings(item.optJSONArray(4)))
        map.getOrPut(host) { ArrayList(1) }.add(entry)
      }
      return map
    }
  }
}
