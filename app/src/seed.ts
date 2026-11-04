export interface PricingInfo {
  official?: string;
  current_best?: string;
  target_deal?: string;
  strategy?: string;
}

export interface LinkItem {
  title: string;
  url: string;
}

export interface DashboardItem {
  id: string;
  type: "todo" | "tobuy" | "wishlist";
  title: string;
  icon?: string;
  wiki_title?: string;
  commons_query?: string;
  img?: string;
  price_summary?: string;
  deal_alert: boolean;
  deal_badge?: string;
  pricing?: PricingInfo;
  notes?: string;
  links?: LinkItem[];
  completed: boolean;
}

const localSeedModules = import.meta.glob<{ INITIAL_DATA: DashboardItem[] }>("./seed.local.ts", {
  eager: true
});

export const INITIAL_DATA = localSeedModules["./seed.local.ts"]?.INITIAL_DATA ?? [];
