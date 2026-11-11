// Original, curated domain categories. Users can extend them with custom rules.
import presetData from '../data/presets.json';

export interface DomainPreset {
  id: string;
  label: string;
  description: string;
  domains: string[];
  urlPatterns: string[];
}

/** Shared with the Rust (include_str!) and Android (assets) builds. */
export const DOMAIN_PRESETS: DomainPreset[] = presetData;

export function presetById(id: string): DomainPreset | undefined {
  return DOMAIN_PRESETS.find((p) => p.id === id);
}

/** Popular Android packages offered as quick picks (app-level blocking for native feeds). */
export const ANDROID_APP_SUGGESTIONS: { packageName: string; label: string }[] = [
  { packageName: 'com.instagram.android', label: 'Instagram' },
  { packageName: 'com.zhiliaoapp.musically', label: 'TikTok' },
  { packageName: 'com.google.android.youtube', label: 'YouTube' },
  { packageName: 'com.facebook.katana', label: 'Facebook' },
  { packageName: 'com.twitter.android', label: 'X' },
  { packageName: 'com.reddit.frontpage', label: 'Reddit' },
  { packageName: 'com.snapchat.android', label: 'Snapchat' },
  { packageName: 'com.netflix.mediaclient', label: 'Netflix' },
];
