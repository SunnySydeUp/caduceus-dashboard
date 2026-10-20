import { useId, useSyncExternalStore } from 'react';
import { APPEARANCE_CHOICES, type Appearance } from '@caduceus/contracts/appearance';
import { AUTO_COMPACT_QUERY } from '../../appearance.ts';
import { Icon, type IconName } from '../../icons.tsx';
import { chooseAppearance, useAppearance } from '../../shell/appearance-store.ts';
import { PageHeader } from '../../shell/PageHeader.tsx';
import { RadioGroup, type RadioOption } from '../../shell/RadioGroup.tsx';

const THEMES: Record<Appearance['theme'], { label: string; icon: IconName }> = {
  light: { label: 'Light', icon: 'sun' },
  dark: { label: 'Dark', icon: 'moon' },
  system: { label: 'System', icon: 'monitor' },
};

const SKINS: Record<Appearance['skin'], { label: string; about: string }> = {
  desk: { label: 'Desk', about: 'Ink on soft greys. Amber only when you are needed. The default.' },
  nous: { label: 'Nous', about: 'Nous blue on cool greys.' },
  hermes: { label: 'Hermes Teal', about: 'The dashboard’s teal, cream and amber.' },
  gold: { label: 'Gold', about: 'Gold on cool greys.' },
  cherenkov: { label: 'Cherenkov', about: 'Cyan on cool greys.' },
  verdant: { label: 'Verdant', about: 'Green on cool greys.' },
  mono: { label: 'Mono', about: 'Ink and paper, square corners.' },
};

const DENSITIES: Record<Appearance['density'], string> = { auto: 'Auto', compact: 'Compact', comfortable: 'Comfortable' };

const TEXT_SIZES: Record<Appearance['textSize'], string> = { sm: 'Small', md: 'Default', lg: 'Large', xl: 'Extra large' };

const subscribeToPointer = (notify: () => void) => {
  const query = matchMedia(AUTO_COMPACT_QUERY);
  query.addEventListener('change', notify);
  return () => query.removeEventListener('change', notify);
};

/** Settings › Appearance: theme, skin, density and text size for this device. A choice applies at once, so the page itself is the preview. */
export function Appearance() {
  const { appearance, pending } = useAppearance();
  const ids = useId();
  const autoIsCompact = useSyncExternalStore(subscribeToPointer, () => matchMedia(AUTO_COMPACT_QUERY).matches);

  const themeOptions: RadioOption<Appearance['theme']>[] = APPEARANCE_CHOICES.theme.map((theme) => ({
    value: theme,
    label: (
      <>
        <Icon name={THEMES[theme].icon} small />
        {THEMES[theme].label}
      </>
    ),
  }));
  const skinOptions: RadioOption<Appearance['skin']>[] = APPEARANCE_CHOICES.skin.map((skin) => ({
    value: skin,
    // The card carries its skin, so it is drawn in that skin's own colours whichever skin the page uses.
    attributes: { 'data-skin': skin },
    label: (
      <>
        <span className="skin-card__swatch">{appearance.skin === skin && <Icon name="check" small />}</span>
        <span className="skin-card__text">
          <span className="skin-card__name">{SKINS[skin].label}</span>
          <span className="skin-card__about">{SKINS[skin].about}</span>
        </span>
      </>
    ),
  }));
  const densityOptions: RadioOption<Appearance['density']>[] = APPEARANCE_CHOICES.density.map((density) => ({ value: density, label: DENSITIES[density] }));
  const textOptions: RadioOption<Appearance['textSize']>[] = APPEARANCE_CHOICES.textSize.map((size) => ({ value: size, label: TEXT_SIZES[size] }));

  return (
    <div className="page-stack">
      <PageHeader title="Appearance" subtitle="How Caduceus looks on this device." />

      <section className="settings-section" aria-labelledby={`${ids}-theme`} data-setting-field="appearance/theme" tabIndex={-1}>
        <h2 id={`${ids}-theme`}>Theme</h2>
        <RadioGroup labelledBy={`${ids}-theme`} className="seg seg--wrap" value={appearance.theme} options={themeOptions} onChange={(theme) => chooseAppearance({ theme })} />
        <p className="help-text">System follows your device’s light or dark setting.</p>
      </section>

      <section className="settings-section" aria-labelledby={`${ids}-skin`} data-setting-field="appearance/skin" tabIndex={-1}>
        <h2 id={`${ids}-skin`}>Skin</h2>
        <RadioGroup labelledBy={`${ids}-skin`} className="skin-grid" optionClassName="skin-card" value={appearance.skin} options={skinOptions} onChange={(skin) => chooseAppearance({ skin })} />
        <p className="help-text">The accent colour and, for Desk and Hermes Teal, the surfaces. Green, amber and red never change with the skin.</p>
      </section>

      <section className="settings-section" aria-labelledby={`${ids}-density`} data-setting-field="appearance/density" tabIndex={-1}>
        <h2 id={`${ids}-density`}>Density</h2>
        <RadioGroup labelledBy={`${ids}-density`} className="seg seg--wrap" value={appearance.density} options={densityOptions} onChange={(density) => chooseAppearance({ density })} />
        <p className="help-text">
          Auto is compact only with a mouse or trackpad on a wide window; on this device it is {autoIsCompact ? 'compact' : 'comfortable'} right now. A touch screen always keeps 44 px touch targets, whatever you choose.
        </p>
      </section>

      <section className="settings-section" aria-labelledby={`${ids}-text`} data-setting-field="appearance/text-size" tabIndex={-1}>
        <h2 id={`${ids}-text`}>Text size</h2>
        <RadioGroup labelledBy={`${ids}-text`} className="seg seg--wrap" value={appearance.textSize} options={textOptions} onChange={(textSize) => chooseAppearance({ textSize })} />
        <p className="help-text">Adds to your browser’s own text size. Everything scales together and the layout reflows rather than scrolling sideways.</p>
      </section>

      <section className="settings-section" aria-labelledby={`${ids}-device`}>
        <h2 id={`${ids}-device`}>This device</h2>
        <p role="status">
          {pending
            ? 'Saved on this device. Caduceus will keep it for this device as soon as it can be reached.'
            : 'Saved on this device and in Caduceus, so it survives signing out and in. Other devices keep their own choices.'}
        </p>
        <p className="help-text">Animations follow your device’s reduced-motion setting.</p>
      </section>
    </div>
  );
}
