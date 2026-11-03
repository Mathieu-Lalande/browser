/**
 * Searchable index of `browser://settings`: each entry deep-links to its row
 * (`browser://settings#section/row`), which the settings page scrolls to and highlights. The
 * anchors are `data-setting` attributes in the settings components (a test checks they exist).
 */

export interface SettingEntry {
  /** `section/row`, or `section` alone for a whole section. */
  anchor: string;
  label: string;
  section: string;
  keywords: readonly string[];
}

const SECTIONS = {
  appearance: "Apparence",
  layout: "Disposition",
  search: "Recherche",
  startPage: "Page d'accueil",
  behavior: "Comportement",
  shortcuts: "Raccourcis clavier",
  privacy: "Confidentialité",
  siteData: "Données des sites",
  translate: "Traduction",
  downloads: "Téléchargements",
  data: "Données",
  sync: "Synchronisation",
  updates: "Mises à jour",
} as const;

type SectionKey = keyof typeof SECTIONS;

const entry = (section: SectionKey, row: string | null, label: string, keywords: string[] = []): SettingEntry => ({
  anchor: row ? `${section}/${row}` : section,
  label,
  section: SECTIONS[section],
  keywords,
});

export const SETTINGS_INDEX: readonly SettingEntry[] = [
  entry("appearance", "theme", "Thème", ["clair", "sombre", "dark", "light", "mode", "système"]),
  entry("appearance", "accent", "Couleur d'accent", ["couleur", "color", "accent"]),
  entry("appearance", "secondary", "Couleur secondaire", ["dégradé", "couleur"]),
  entry("appearance", "background", "Arrière-plan", ["fond", "dégradé", "background"]),
  entry("appearance", "font", "Police de l'interface", ["typographie", "font", "police"]),
  entry("appearance", "density", "Densité", ["compact", "hauteur", "taille"]),
  entry("appearance", "radius", "Arrondi des coins", ["rayon", "coins", "radius"]),
  entry("appearance", "shadows", "Ombres", ["shadow", "ombre"]),
  entry("appearance", "reduce-motion", "Réduire les animations", ["animations", "mouvement", "motion"]),
  entry("appearance", "hand-cursor", "Curseur main", ["pointeur", "souris", "cursor"]),
  entry("appearance", "dynamic-theme", "Thème dynamique", ["couleur du site", "theme-color", "accent", "adaptatif"]),
  entry("appearance", "page-zoom", "Zoom par défaut", ["zoom", "taille des pages", "agrandir"]),
  entry("layout", "sidebar-position", "Position de la barre latérale", ["gauche", "droite", "sidebar"]),
  entry("layout", "sidebar-width", "Largeur de la barre latérale", ["sidebar", "largeur"]),
  entry("layout", "gutter", "Marge autour de la page", ["bord", "marge", "gutter"]),
  entry("layout", "zen", "Mode zen", ["plein écran", "focus", "zen"]),
  entry("layout", "tab-preview", "Aperçu des onglets au survol", ["miniature", "survol", "vignette", "hover", "preview"]),
  entry("search", "engine", "Moteur de recherche", ["google", "duckduckgo", "brave", "startpage", "search engine"]),
  entry("startPage", "name", "Prénom", ["accueil", "bonjour", "nom"]),
  entry("startPage", "widgets", "Widgets de la page d'accueil", ["horloge", "heure", "notes", "météo", "tâches", "widgets"]),
  entry("startPage", "background", "Fond de la page d'accueil", ["image", "fond", "wallpaper"]),
  entry("behavior", "default-browser", "Navigateur par défaut", ["défaut", "default", "liens", "pdf", "html"]),
  entry("behavior", "restore-session", "Restaurer la session au démarrage", ["session", "démarrage", "rouvrir"]),
  entry("behavior", "new-tab-position", "Ouvrir les nouveaux onglets", ["position", "nouvel onglet"]),
  entry("behavior", "after-close", "Après la fermeture d'un onglet, afficher", ["fermer", "fermeture"]),
  entry("behavior", "sleep", "Mettre en veille les onglets inactifs", ["veille", "mémoire", "sleep"]),
  entry("behavior", "archive", "Archiver les onglets inactifs", ["archive", "archivage"]),
  entry("shortcuts", null, "Raccourcis clavier", ["raccourci", "touches", "keyboard", "shortcut"]),
  entry("privacy", "weather", "Widget Météo", ["open-meteo", "localisation", "réseau"]),
  entry("privacy", "accept-language", "Uniformiser la langue envoyée aux sites", ["langue", "empreinte", "fingerprint"]),
  entry("privacy", "drm", "Contenus protégés (DRM)", ["widevine", "netflix", "disney", "spotify", "prime video", "streaming"]),
  entry("siteData", "third-party-cookies", "Bloquer les cookies tiers", ["cookies", "pistage", "tracking"]),
  entry("siteData", null, "Cookies et données des sites", ["cookies", "stockage", "effacer"]),
  entry("translate", "provider", "Service de traduction", ["traduire", "translate", "deepl", "libretranslate", "google"]),
  entry("translate", "target", "Langue de traduction", ["traduire vers", "langue", "translate"]),
  entry("translate", "offer", "Proposer de traduire les pages", ["traduction", "barre d'adresse"]),
  entry("downloads", "folder", "Dossier des téléchargements", ["dossier", "emplacement", "download"]),
  entry("downloads", "ask-where", "Toujours demander où enregistrer", ["enregistrer", "demander"]),
  entry("downloads", "executables", "Fichiers exécutables", ["exe", "programmes", "sécurité"]),
  entry("data", "import", "Importer depuis un autre navigateur", ["import", "chrome", "firefox", "edge", "arc", "mots de passe", "csv"]),
  entry("data", "history", "Historique de navigation", ["effacer", "historique", "history"]),
  entry("data", "bookmarks", "Favoris", ["bookmarks", "signets"]),
  entry("sync", null, "Synchronisation", ["appareils", "sync", "jumelage", "compte"]),
  entry("sync", "annotations", "Synchroniser les notes et surlignages", ["notes", "surlignages", "annotations", "highlights"]),
  entry("updates", null, "Mises à jour", ["version", "update", "mettre à jour"]),
];

/** `browser://settings#…` for an entry. */
export const settingUrl = (entry: SettingEntry) => `browser://settings#${entry.anchor}`;
