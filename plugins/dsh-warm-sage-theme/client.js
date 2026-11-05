window.__ModuleLoader__.load({
  id: '@local/warm-sage-theme',
  factory(require) {
    /** Layer identity: one token layer per source; re-applying replaces the whole layer. */
    const SOURCE = '@local/warm-sage-theme'

    const pair = (light, dark) => ({ light, dark })
    /** The warm ramp reads the same in both schemes. */
    const both = (value) => ({ light: value, dark: value })

    const sage = pair('#3E7434', '#71AA61')

    /**
     * Calm warm-grey surfaces with a sage accent, kept deliberately low-contrast.
     *
     * Tuned for long reading sessions: the light canvas sits near 80% relative
     * luminance instead of near-white, and the dark canvas is a warm ink just
     * above black rather than the shipped near-black-grey. Ink is held well
     * under the shipped near-black/bright pair, so large fields of text read
     * softly: primary lands near 7.4:1 light / 8.0:1 dark where the product
     * palette sat at 9-10:1.
     *
     * Two rules keep the softening from eating legibility:
     *   - no token is sharper than before on any surface it can appear on;
     *   - wherever the shipped pairing reached AA (4.5:1) the new one still
     *     does, so only purely decorative tiers sit below AA.
     *
     * The tiers land near: primary 7.4 / 8.0, secondary 5.4 / 6.6, tertiary
     * 4.9 / 5.6, caption 4.6 / 4.4 (light / dark).
     *
     * The shipped alias layer resolves most tokens through the static ramps, so
     * overriding the ramps turns every derived color at once; the alias entries
     * then pin the tokens whose shipped definition is a literal color.
     */
    const TOKENS = {
      // ---- static ramps: warm grey paper -> warm ink -------------------------
      '--dsw-static-neutral-bluish-00': both('#F6F5EF'),
      '--dsw-static-neutral-bluish-50': both('#EFEEE6'),
      '--dsw-static-neutral-bluish-60': both('#EBEAE2'),
      '--dsw-static-neutral-bluish-75': both('#E6E5DC'),
      '--dsw-static-neutral-bluish-100': both('#E0DFD5'),
      '--dsw-static-neutral-bluish-150': both('#D8D6CB'),
      '--dsw-static-neutral-bluish-200': both('#CFCCC0'),
      '--dsw-static-neutral-bluish-300': both('#BEBBAE'),
      '--dsw-static-neutral-bluish-400': both('#A29F92'),
      '--dsw-static-neutral-bluish-500': both('#8A877A'),
      '--dsw-static-neutral-bluish-550': both('#757263'),
      '--dsw-static-neutral-bluish-600': both('#635F52'),
      '--dsw-static-neutral-bluish-700': both('#514E42'),
      '--dsw-static-neutral-bluish-750': both('#433F35'),
      '--dsw-static-neutral-bluish-800': both('#37342B'),
      '--dsw-static-neutral-bluish-850': both('#2C2921'),
      '--dsw-static-neutral-bluish-875': both('#25221B'),
      '--dsw-static-neutral-bluish-900': both('#1F1C17'),
      '--dsw-static-neutral-bluish-950': both('#0E0D0C'),
      '--dsw-static-neutral-bluish-1000': both('#14120E'),

      // The pure neutral ramp backs scrollbars, inline code, idle marks, and a
      // few feature panels that reference it directly instead of an alias.
      '--dsw-static-neutral-00': both('#F6F5EF'),
      '--dsw-static-neutral-50': both('#F1F0E9'),
      '--dsw-static-neutral-100': both('#E9E8DF'),
      '--dsw-static-neutral-150': both('#E4E2D8'),
      '--dsw-static-neutral-200': both('#DCD9CE'),
      '--dsw-static-neutral-250': both('#D4D1C5'),
      '--dsw-static-neutral-300': both('#C9C6B9'),
      '--dsw-static-neutral-400': both('#ADA99A'),
      '--dsw-static-neutral-500': both('#918D7C'),
      '--dsw-static-neutral-550': both('#7B7768'),
      '--dsw-static-neutral-600': both('#666254'),
      '--dsw-static-neutral-700': both('#4E4A3E'),
      '--dsw-static-neutral-800': both('#3A362C'),
      '--dsw-static-neutral-850': both('#2E2A22'),
      '--dsw-static-neutral-900': both('#201D18'),
      '--dsw-static-neutral-1000': both('#14120E'),

      // ---- static ramps: the product accent becomes sage --------------------
      '--dsw-static-deepseek-50': both('#EDF4E9'),
      '--dsw-static-deepseek-100': both('#DBE9D2'),
      '--dsw-static-deepseek-200': both('#C4DCB6'),
      '--dsw-static-deepseek-300': both('#A7C996'),
      '--dsw-static-deepseek-400': both('#84B571'),
      '--dsw-static-deepseek-450': both('#659F52'),
      '--dsw-static-deepseek-500': both('#3E7434'),
      '--dsw-static-deepseek-600': both('#33632A'),
      '--dsw-static-deepseek-700-delete': both('#2D5825'),
      '--dsw-static-deepseek-800': both('#294223'),
      '--dsw-static-deepseek-900': both('#243620'),

      '--dsw-static-blue-50': both('#EDF4E9'),
      '--dsw-static-blue-50p': both('#E7F0E1'),
      '--dsw-static-blue-75': both('#E6EFDF'),
      '--dsw-static-blue-100': both('#DAE8D1'),
      '--dsw-static-blue-200': both('#C6DCB9'),
      '--dsw-static-blue-300': both('#A6C994'),
      '--dsw-static-blue-400': both('#80B56C'),
      '--dsw-static-blue-450': both('#68A153'),
      '--dsw-static-blue-500': both('#4C8540'),
      '--dsw-static-blue-600': both('#3F7134'),
      '--dsw-static-blue-800': both('#2D4626'),
      '--dsw-static-blue-900': both('#253720'),
      '--dsw-static-blue-950': both('#1C2A18'),

      '--dsw-static-green-100': both('#DFEBD8'),
      '--dsw-static-green-400': both('#6EA968'),
      '--dsw-static-green-500': both('#4D8A49'),
      '--dsw-static-green-500-a08': both('#4D8A4914'),
      '--dsw-static-green-500-a12': both('#4D8A491F'),
      '--dsw-static-green-900': both('#212F1E'),

      // ---- base surfaces ----------------------------------------------------
      '--dsw-alias-bg-base': pair('#E8E7DF', '#141312'),
      '--dsw-alias-bg-l1': pair('#E2E1D8', '#101010'),
      '--dsw-alias-bg-layer-1': pair('#EDECE4', '#191714'),
      '--dsw-alias-bg-layer-2': pair('#F1F0E9', '#1C1A17'),
      '--dsw-alias-bg-layer-3': pair('#F5F4ED', '#201D1A'),
      '--dsw-alias-bg-layer-4': pair('#F8F7F1', '#24211E'),
      '--dsw-alias-bg-overlay': pair('#DDDBD1', '#221F1C'),
      '--dsw-alias-bg-module-platform': pair('#E4EBDC', '#202C1E'),
      '--dsw-alias-bg-multi-select': pair('#E6E5DC', '#1C1A17'),
      '--dsw-alias-bg-document-preview': pair('#EEEDE5', '#141312'),
      '--dsw-alias-bg-skeleton': pair('#3A342812', '#F6F5EF14'),

      // Masks keep their transparency; only the tint turns warm.
      '--dsw-alias-bg-mask-1': pair('#3A34283D', '#00000080'),
      '--dsw-alias-bg-mask-2': pair('#3A34281F', '#00000040'),
      '--dsw-alias-bg-mask-3': pair('#3A34287A', '#0000007A'),
      '--dsw-alias-bg-mask-drop': pair('#E8E7DFB3', '#1C1A17B3'),
      '--dsw-alias-bg-mask-photo': both('#000000E0'),

      // ---- borders: a shade lighter than the shipped hairlines --------------
      '--dsw-alias-border-l1': pair('#3A342811', '#F6F5EF11'),
      '--dsw-alias-border-l2': pair('#3A342820', '#F6F5EF1F'),
      '--dsw-alias-border-l2-darkmode-thin': pair('#3A342820', '#F6F5EF11'),
      '--dsw-alias-border-l3': pair('#3A342830', '#F6F5EF2C'),
      '--dsw-alias-border-l4': pair('#3A34283F', '#F6F5EF37'),
      '--dsw-alias-border-inverted': pair('transparent', '#F6F5EF11'),
      '--dsw-alias-border-inverted2': pair('transparent', '#F6F5EF16'),
      '--dsw-alias-separator-primary': pair('#3A342820', '#F6F5EF1F'),

      // ---- text -------------------------------------------------------------
      '--dsw-alias-label-primary': pair('#4A483F', '#AFAA9C'),
      '--dsw-alias-label-primary-dimmed': pair('#4E4C43', '#AAA497'),
      '--dsw-alias-label-primary-bluish': pair('#495442', '#ADA89A'),
      '--dsw-alias-label-primary-foreground': pair('#F6F5EF', '#100F0E'),
      '--dsw-alias-label-primary-inverted': pair('#F6F5EF', '#24211E'),
      '--dsw-alias-label-secondary': pair('#5F5C53', '#A09A8A'),
      '--dsw-alias-label-tertiary': pair('#636054', '#958D7B'),
      '--dsw-alias-label-caption': pair('#6A6756', '#837A68'),
      '--dsw-alias-label-dimmed': pair('#CAC7BA', '#3F3930'),
      '--dsw-alias-label-quaternary': pair('#7E7A69', '#726A59'),
      '--dsw-alias-label-document-preview': pair('#5F5C53', '#A09A8A'),
      '--dsw-alias-label-shimmer': pair('#4A483F4D', '#AFAA9C73'),
      '--dsw-alias-label-deep-diving': pair('#3A7030', '#7BB46A'),
      '--dsw-alias-label-deep-diving-shimmer': pair('#80B56C', '#7E9E6D'),
      '--dsw-alias-link': pair('#3A7030', '#7CB46D'),

      // ---- brand and buttons ------------------------------------------------
      '--dsw-alias-brand-primary': sage,
      '--dsw-alias-brand-primary-invert': pair('#4F4C44', '#9E988A'),
      '--dsw-alias-brand-primary-new-colorprimary-new-color': pair('#3E7434', '#74A561'),
      '--dsw-alias-brand-text': pair('#4F4C44', '#9E988A'),
      '--dsw-alias-button-primary-fill': sage,
      '--dsw-alias-button-primary-hover': pair('#3A6A31', '#87B477'),
      '--dsw-alias-button-primary-dimmed': pair('#E0DFD5', '#24211E'),
      '--dsw-alias-button-contrast-fill': pair('#615E55', '#958F81'),
      '--dsw-alias-button-elevated-fill': pair('#F6F5EF', '#201D1A'),
      '--dsw-alias-button-floating-fill': pair('#F6F5EF', '#1C1A17'),
      '--dsw-alias-button-floating-hover': pair('#E6E5DC', '#201D1A'),
      '--dsw-alias-button-ghost-active-border': pair('#979487', '#4F493E'),
      '--dsw-alias-button-ghost-active-fill': pair('#E0DFD5', '#24211E'),
      '--dsw-alias-button-ghost-active-hover': pair('#D8D6CB', '#342E29'),
      '--dsw-alias-button-info-fill': pair('#3E7434', '#74A561'),
      '--dsw-alias-button-info-hover': pair('#4C843E', '#67A052'),
      '--dsw-alias-button-tool-bar-fill': pair('#433F3580', '#433F3580'),
      '--dsw-alias-button-tool-bar-fill-invisible': pair('#2E2B245C', '#2E2B245C'),
      '--dsw-alias-button-tool-bar-hover': pair('#433F3599', '#433F3599'),

      // ---- interaction washes ----------------------------------------------
      '--dsw-alias-interactive-bg-hover': pair('#3A342811', '#F6F5EF11'),
      '--dsw-alias-interactive-bg-active': pair('#3A342822', '#F6F5EF20'),
      '--dsw-alias-interactive-bg-hover-accent': pair('#3A70301F', '#97D2862B'),
      '--dsw-alias-interactive-bg-hover-danger': pair('#B44A3212', '#E4816922'),
      '--dsw-alias-interactive-bg-hover-solid': pair('#DDDBD1', '#201D1A'),
      '--dsw-alias-fill-l1': pair('#3A342811', '#F6F5EF11'),
      '--dsw-alias-fill-l2': pair('#3A342822', '#F6F5EF20'),
      '--dsw-alias-fill-tertiary': pair('#E0DFD5', '#201D1A'),
      '--dsw-alias-fill-tsp-secondary': pair('#3A34280A', '#F6F5EF0A'),

      // ---- floating surfaces -----------------------------------------------
      '--dsw-specific-menu': pair('#F2F5EB99', '#252D23B3'),
      '--dsw-menu-surface-fill': pair('#F2F5EB99', '#252D23B3'),
      '--dsw-alias-menu-group-header-fill': pair('#EFF3E8F0', '#252D23F0'),
      '--dsw-alias-menu-icon': pair('#5F5C53', '#9F9A8C'),
      '--dsw-alias-tooltip-bg': pair('#2E2B24', '#2F2B26'),
      '--dsw-alias-tooltip-key-bg': pair(
        'color-mix(in srgb, #2E2B24, white 18%)',
        'color-mix(in srgb, #2F2B26, white 18%)',
      ),
      '--dsw-alias-toast-bg': pair('#2E2B24', '#2F2B26'),
      '--dsw-alias-toast-label': pair('#F6F5EF', '#F6F5EF'),
      '--dsw-alias-switch-thumb': pair('#F6F5EF', '#9A9280'),
      '--dsw-specific-tip': pair('#E3EADD', '#222C20'),
      '--dsw-specific-selector': pair('#E3EADD', '#222C20'),
      '--dsw-specific-login-input': pair('#ECEBE3', '#191714'),

      // ---- composer, bubbles, cards ----------------------------------------
      '--dsw-specific-input-major': pair('#F0EFE7', '#1E1B17'),
      '--dsw-specific-bubble': pair('#DCE7D2', '#1C261B'),
      '--dsw-specific-bubble-highlight': pair('#C4DCB6', '#24401F'),
      '--dsw-alias-settings-card-fill': pair('#F1F0E8', '#1C1A17'),
      '--dsw-alias-settings-card-stroke': pair('#3A342823', '#F6F5EF37'),
      '--dsw-alias-turn-trigger-bg': pair('#EFEEE6', '#F6F5EF11'),
      '--dsw-alias-turn-trigger-bg-hover': pair('#3A342811', '#F6F5EF20'),

      // ---- sidebar ----------------------------------------------------------
      '--dsw-specific-sidebar-fill': pair('#E2E1D8', '#0E0E0D'),
      '--dsw-specific-sidebar-nav-item-active': pair('#DAD8CE', '#24211E'),
      '--dsw-specific-sidebar-nav-item-active-accent': pair('#D8E4CD', '#1F2A1D'),
      '--dsw-specific-sidebar-nav-item-hover': pair('#E6E5DC', '#1C1A17'),

      // ---- scrollbars -------------------------------------------------------
      '--dsw-alias-scrollbar-bg-l1': pair('#D4D1C5', '#2E2A25'),
      '--dsw-alias-scrollbar-bg-l2': pair('#D4D1C5', '#332F2A'),
      '--dsw-alias-scrollbar-hover-l1': pair('#C9C6B9', '#362F29'),
      '--dsw-alias-scrollbar-hover-l2': pair('#C9C6B9', '#3B342E'),

      // ---- markdown and code ------------------------------------------------
      '--dsw-alias-markdown-code-block': pair('#EEEDE5', '#191714'),
      '--dsw-alias-markdown-code-block-banner': pair('#F1F0E9', '#1C1A17'),
      '--dsw-alias-markdown-code-segment-selected': pair('#F5F4ED', '#24211E'),
      '--dsw-alias-markdown-code-segment-unselected': pair('#E6E5DC', '#141312'),
      '--dsw-alias-markdown-inline-code': pair('#ECEBE3', '#1C1A17'),
      '--dsw-alias-markdown-placeholder': pair('#EAE9E1', '#1C1A17'),
      '--dsw-alias-markdown-tag': pair('#E1E9D6', '#1D261C'),
      '--dsw-alias-markdown-citation': pair('#DBE5D0', '#232D21'),
      '--dsw-alias-bg-document-selection': pair(
        'color-mix(in srgb, #4A823C 24%, transparent)',
        'color-mix(in srgb, #97D286 20%, transparent)',
      ),

      // Syntax colors, hue-matched to the calmer surfaces and pulled equally
      // back from the code block so highlighting reads without sparkling.
      '--shiki-foreground': pair('#4F4D45', '#AAA496'),
      '--shiki-background': pair('#EEEDE5', '#191714'),
      '--shiki-token-constant': pair('#9D4520', '#C98A5B'),
      '--shiki-token-string': pair('#3F7A3C', '#73AB6B'),
      '--shiki-token-comment': pair('#7B7662', '#776F5E'),
      '--shiki-token-keyword': pair('#984460', '#CA83A1'),
      '--shiki-token-parameter': pair('#8A5A10', '#C68F26'),
      '--shiki-token-function': pair('#64559D', '#A190CF'),
      '--shiki-token-string-expression': pair('#35702F', '#7CA971'),
      '--shiki-token-punctuation': pair('#646052', '#9A9484'),
      '--shiki-token-link': pair('#3A7030', '#74AB64'),

      // ---- state colors -----------------------------------------------------
      '--dsw-alias-state-business-primary': sage,
      '--dsw-alias-state-business-tertiary': pair('#D7E5CC', '#1F2F1B'),
      '--dsw-alias-state-idle-primary': pair('#CAC7BA', '#3F3930'),
      '--dsw-alias-state-success-primary': pair('#518F4D', '#67A261'),
      '--dsw-alias-state-success-secondary': pair('#73AF6D', '#609859'),
      '--dsw-alias-state-success-tertiary': pair('#DFEBD8', '#212F1E'),
      '--dsw-alias-state-warn-label': pair('#8E5B0D', '#C79028'),
      '--dsw-alias-state-warn-primary': pair('#CA8D27', '#BF8703'),
      '--dsw-alias-state-warn-secondary': pair('#DBA442', '#B38201'),
      '--dsw-alias-state-warn-tertiary': pair('#F5EBD8', '#292216'),
      '--dsw-alias-state-error-primary': pair('#AC442C', '#D97760'),
      '--dsw-alias-state-error-secondary': pair('#C65F45', '#D06F57'),

      // ---- diffs ------------------------------------------------------------
      '--dsw-alias-code-diff-added': pair('#4D8A4914', '#6EA9681F'),
      '--dsw-alias-code-diff-deleted': pair('#AC442C14', '#E481691F'),
      '--dsw-alias-file-diff-added-bg': pair('#DCE7D5', '#1B231C'),
      '--dsw-alias-file-diff-added-gutter': pair('#E4EEDE', '#161C16'),
      '--dsw-alias-file-diff-added-marker': pair('#4D8A49', '#6EA968'),
      '--dsw-alias-file-diff-deleted-bg': pair('#F2E1DA', '#261916'),
      '--dsw-alias-file-diff-deleted-gutter': pair('#F7EAE4', '#1A110E'),
      '--dsw-alias-file-diff-deleted-marker': pair('#AC442C', '#E48169'),

      // ---- onboarding -------------------------------------------------------
      '--dsw-alias-onboarding-accent': sage,
      '--dsw-alias-onboarding-card-fill': pair('#F6F5EFCC', '#1C1A17CC'),
      '--dsw-alias-onboarding-secondary-fill': pair('#F6F5EF', '#342E29'),
      '--dsw-alias-onboarding-checkbox-border': pair('#2D2B2333', '#F6F5EF1F'),

      // ---- reasoning fades, painted as literal gradients in the theme sheets -
      '--dsw-linear-gradient-think': pair(
        'linear-gradient(180deg, #E8E7DF 20.19%, #E8E7DF00 100%)',
        'linear-gradient(180deg, #141312 20.19%, #14131200 100%)',
      ),
      '--dsw-linear-think-select': pair(
        'linear-gradient(180deg, #EDECE4 20.19%, #EDECE400 100%)',
        'linear-gradient(180deg, #191714 20.19%, #19171400 100%)',
      ),
    }

    return {
      inject: ['theme'],
      apply(ctx) {
        const theme = ctx.get('theme')
        if (theme === undefined) {
          console.warn('warm-sage: theme service unavailable, palette not applied')
          return
        }
        ctx.effect(() => theme.overrideTokens(SOURCE, TOKENS), 'warm-sage: token layer')
      },
    }
  },
})
