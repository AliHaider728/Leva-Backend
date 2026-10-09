import { randomUUID } from 'node:crypto';

export const SYSTEM_NAVIGATION_KEYS = [
  'home', 'shop', 'categories', 'about', 'contact', 'wishlist', 'account'
] as const;

export const HOMEPAGE_SECTION_KEYS = [
  'hero', 'categories', 'ageGroups', 'featuredProducts', 'brandCampaign', 'newArrivals'
] as const;

export const INTERNAL_PAGE_ROUTES: Record<string, string> = {
  home: '/',
  shop: '/category/all',
  categories: '/category/all',
  about: '/about',
  contact: '/contact',
  wishlist: '/wishlist',
  account: '/account'
};

export type NavigationLinkType = 'internal_page' | 'category' | 'custom_internal_url' | 'external_url';
export type NavigationMenuType = 'link' | 'dropdown';
export type HomepageSectionKey = typeof HOMEPAGE_SECTION_KEYS[number];

export interface StorefrontNavigationItem {
  id: string;
  key: string;
  label: string;
  linkType: NavigationLinkType;
  menuType: NavigationMenuType;
  path?: string;
  externalUrl?: string;
  categoryId?: string;
  parentId?: string | null;
  visible: boolean;
  enabled: boolean;
  showOnDesktop: boolean;
  showOnMobile: boolean;
  displayOrder: number;
  order?: number;
  badgeText?: string;
  openInNewTab?: boolean;
  isSystemItem: boolean;
}

export interface HomepageSectionSetting {
  key: HomepageSectionKey;
  name: string;
  enabled: boolean;
  order: number;
  heading?: string;
  subheading?: string;
  ctaLabel?: string;
  ctaLink?: string;
}

const systemItem = (
  key: typeof SYSTEM_NAVIGATION_KEYS[number],
  label: string,
  displayOrder: number,
  overrides: Partial<StorefrontNavigationItem> = {}
): StorefrontNavigationItem => ({
  id: `nav-${key}`,
  key,
  label,
  linkType: 'internal_page',
  menuType: 'link',
  path: INTERNAL_PAGE_ROUTES[key],
  parentId: null,
  visible: true,
  enabled: true,
  showOnDesktop: true,
  showOnMobile: true,
  displayOrder,
  order: displayOrder,
  isSystemItem: true,
  ...overrides
});

export const DEFAULT_STOREFRONT_NAVIGATION: StorefrontNavigationItem[] = [
  systemItem('home', 'Home', 0),
  systemItem('shop', 'Shop', 1, { showOnMobile: false }),
  systemItem('categories', 'Shop Categories', 2, { menuType: 'dropdown' }),
  systemItem('about', 'About', 3, { showOnMobile: false }),
  systemItem('contact', 'Contact', 4, { showOnMobile: false }),
  systemItem('wishlist', 'Wishlist', 5, { showOnDesktop: false }),
  systemItem('account', 'Account', 6, { showOnDesktop: false })
];

export const DEFAULT_HOMEPAGE_SECTIONS: HomepageSectionSetting[] = [
  { key: 'hero', name: 'Hero', enabled: true, order: 0, heading: 'Skincare, Made Simple.', subheading: 'Discover clean, effective formulas that nourish your skin and reveal your natural radiance every day.', ctaLabel: 'Explore All Skincare', ctaLink: '/category/all' },
  { key: 'categories', name: 'Shop by Category', enabled: true, order: 1, heading: 'Shop by Category', subheading: 'Browse Collections', ctaLabel: 'View All Categories', ctaLink: '/category/all' },
  { key: 'ageGroups', name: 'Shop by Skin Concern', enabled: true, order: 2, heading: 'Shop by Skin Concern', subheading: 'Find the perfect, targeted treatments designed for your specific skin needs.' },
  { key: 'featuredProducts', name: 'Featured Products', enabled: true, order: 3, heading: 'Featured Products & Bestsellers', subheading: 'Hot Picks', ctaLabel: 'Shop All Bestsellers', ctaLink: '/category/all' },
  { key: 'brandCampaign', name: 'Play, Learn, Grow', enabled: true, order: 4, heading: 'Discover Formulas That Make Skincare Simple', subheading: 'From hydrating serums and gentle cleansers to targeted barrier repair, Alvora brings clean, scientifically-backed formulas that reveal your best skin at every age.', ctaLabel: 'Explore Skincare Favorites', ctaLink: '/category/all' },
  { key: 'newArrivals', name: 'New Arrivals', enabled: true, order: 5, heading: 'New Arrivals & Restocks', subheading: 'Fresh In Store', ctaLabel: 'Browse New Additions', ctaLink: '/category/all' }
];

const cleanText = (value: unknown, maxLength: number) =>
  String(value ?? '').replace(/<[^>]*>/g, '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, maxLength);

export const safeInternalLink = (value: unknown, fallback = '') => {
  const raw = String(value ?? '').trim();
  if (!raw) return fallback;
  const normalized = `/${raw.replace(/^\/+/, '').replace(/\/{2,}/g, '/')}`;
  if (
    normalized.length > 200 ||
    !/^\/(?!\/)[a-zA-Z0-9/_?=&%+.,#-]*$/.test(normalized) ||
    /^\/admin(?:\/|$)/i.test(normalized) ||
    /javascript:|data:|vbscript:|file:|%2f|%5c|(?:^|\/)\.\.(?:\/|$)/i.test(normalized)
  ) throw new Error('Custom internal links must be safe public paths beginning with /');
  return normalized;
};

const safeExternalLink = (value: unknown) => {
  const raw = String(value ?? '').trim();
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'https:' || !parsed.hostname) throw new Error();
    return parsed.toString();
  } catch {
    throw new Error('External links must be valid HTTPS URLs');
  }
};

const normalizeOrder = (items: StorefrontNavigationItem[]) => {
  const groups = new Map<string, StorefrontNavigationItem[]>();
  items.forEach(item => {
    const key = item.parentId || '__root__';
    groups.set(key, [...(groups.get(key) || []), item]);
  });
  groups.forEach(group => group
    .sort((a, b) => a.displayOrder - b.displayOrder)
    .forEach((item, index) => { item.displayOrder = index; item.order = index; }));
  return items.sort((a, b) => {
    if ((a.parentId || '') === (b.parentId || '')) return a.displayOrder - b.displayOrder;
    return (a.parentId || '').localeCompare(b.parentId || '');
  });
};

const normalizeNavigationItem = (raw: any, defaults?: StorefrontNavigationItem): StorefrontNavigationItem => {
  const isSystemItem = Boolean(defaults);
  const id = cleanText(raw?.id, 80) || defaults?.id || `nav-${randomUUID()}`;
  const key = defaults?.key || cleanText(raw?.key, 80) || `custom-${id.replace(/^nav-/, '')}`;
  const linkType = ['internal_page', 'category', 'custom_internal_url', 'external_url'].includes(raw?.linkType)
    ? raw.linkType as NavigationLinkType
    : defaults?.linkType || 'custom_internal_url';
  const menuType = raw?.menuType === 'dropdown' ? 'dropdown' : defaults?.menuType || 'link';
  const item: StorefrontNavigationItem = {
    id,
    key,
    label: cleanText(raw?.label, 50) || defaults?.label || 'Navigation Item',
    linkType,
    menuType,
    parentId: cleanText(raw?.parentId, 80) || null,
    visible: typeof raw?.visible === 'boolean' ? raw.visible : defaults?.visible ?? true,
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : defaults?.enabled ?? true,
    showOnDesktop: typeof raw?.showOnDesktop === 'boolean' ? raw.showOnDesktop : defaults?.showOnDesktop ?? true,
    showOnMobile: typeof raw?.showOnMobile === 'boolean' ? raw.showOnMobile : defaults?.showOnMobile ?? true,
    displayOrder: Number.isInteger(raw?.displayOrder ?? raw?.order) ? Number(raw.displayOrder ?? raw.order) : defaults?.displayOrder ?? 0,
    badgeText: cleanText(raw?.badgeText, 20) || undefined,
    openInNewTab: raw?.openInNewTab === true,
    isSystemItem
  };
  item.order = item.displayOrder;
  if (linkType === 'internal_page') {
    const submittedPath = safeInternalLink(raw?.path);
    const knownPath = isSystemItem
      ? INTERNAL_PAGE_ROUTES[key]
      : Object.values(INTERNAL_PAGE_ROUTES).find(path => path === submittedPath);
    if (!knownPath) throw new Error(`Choose a valid public page for ${item.label}`);
    item.path = knownPath;
  } else if (linkType === 'category') {
    item.categoryId = cleanText(raw?.categoryId, 80);
    if (!item.categoryId) throw new Error(`Choose a category for ${item.label}`);
  } else if (linkType === 'custom_internal_url') {
    item.path = safeInternalLink(raw?.path);
  } else {
    item.externalUrl = safeExternalLink(raw?.externalUrl ?? raw?.path);
  }
  if (menuType === 'dropdown') {
    item.path = undefined;
    item.externalUrl = undefined;
    item.categoryId = undefined;
    item.openInNewTab = false;
  }
  return item;
};

export const normalizeStoredNavigation = (value: unknown): StorefrontNavigationItem[] => {
  const stored = Array.isArray(value) ? value : [];
  const system = DEFAULT_STOREFRONT_NAVIGATION.map(defaultItem => {
    const candidate = stored.find((item: any) => item?.key === defaultItem.key) || defaultItem;
    try { return normalizeNavigationItem(candidate, defaultItem); } catch { return { ...defaultItem }; }
  });
  const custom = stored
    .filter((item: any) => item && !SYSTEM_NAVIGATION_KEYS.includes(item.key))
    .flatMap((item: any) => {
      try { return [normalizeNavigationItem(item)]; } catch { return []; }
    });
  return normalizeOrder([...system, ...custom]);
};

export const normalizeStoredHomepageSections = (value: unknown): HomepageSectionSetting[] => {
  const stored = Array.isArray(value) ? value : [];
  return DEFAULT_HOMEPAGE_SECTIONS.map(defaultSection => {
    const candidate = stored.find((item: any) => item?.key === defaultSection.key) || {};
    return {
      ...defaultSection,
      enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : defaultSection.enabled,
      order: Number.isInteger(candidate.order) ? candidate.order : defaultSection.order,
      heading: cleanText(candidate.heading, 120) || defaultSection.heading,
      subheading: cleanText(candidate.subheading, 320) || defaultSection.subheading,
      ctaLabel: defaultSection.ctaLabel ? cleanText(candidate.ctaLabel, 60) || defaultSection.ctaLabel : undefined,
      ctaLink: defaultSection.ctaLink ? safeInternalLink(candidate.ctaLink, defaultSection.ctaLink) : undefined
    };
  }).sort((a, b) => a.order - b.order).map((item, order) => ({ ...item, order }));
};

const validateNavigationGraph = (items: StorefrontNavigationItem[]) => {
  if (items.length > 60) throw new Error('Navigation can contain at most 60 items');
  const ids = items.map(item => item.id);
  const keys = items.map(item => item.key);
  if (new Set(ids).size !== ids.length) throw new Error('Navigation item IDs must be unique');
  if (new Set(keys).size !== keys.length) throw new Error('Navigation item keys must be unique');
  for (const systemKey of SYSTEM_NAVIGATION_KEYS) {
    if (!items.some(item => item.key === systemKey && item.isSystemItem)) {
      throw new Error(`Navigation must include every stable key; required system item ${systemKey} is missing`);
    }
  }
  const byId = new Map(items.map(item => [item.id, item]));
  items.forEach(item => {
    if (!item.parentId) return;
    if (item.parentId === item.id) throw new Error('Navigation items cannot be their own parent');
    const parent = byId.get(item.parentId);
    if (!parent) throw new Error(`Navigation parent for ${item.label} does not exist`);
    if (parent.parentId) throw new Error('Navigation supports only one child level');
    if (parent.menuType !== 'dropdown') throw new Error(`Parent ${parent.label} must be a dropdown`);
    if (item.menuType === 'dropdown') throw new Error('Dropdown children cannot contain another dropdown');
  });
};

export const validateAppearanceInput = (body: Record<string, unknown>) => {
  if (!Array.isArray(body.storefrontNavigation) || !Array.isArray(body.homepageSections)) {
    throw new Error('Navigation and homepage section settings are required');
  }
  const submitted = body.storefrontNavigation as any[];
  const navigation = normalizeOrder(submitted.map(raw => {
    const defaults = DEFAULT_STOREFRONT_NAVIGATION.find(item => item.key === raw?.key);
    return normalizeNavigationItem(raw, defaults);
  }));
  validateNavigationGraph(navigation);

  const sectionKeys = (body.homepageSections as any[]).map(item => item?.key);
  if (sectionKeys.length !== HOMEPAGE_SECTION_KEYS.length || new Set(sectionKeys).size !== sectionKeys.length || sectionKeys.some(key => !HOMEPAGE_SECTION_KEYS.includes(key))) {
    throw new Error('Homepage sections must include every stable key exactly once');
  }
  const homepageSections = normalizeStoredHomepageSections(body.homepageSections);
  return { navigation, homepageSections };
};
