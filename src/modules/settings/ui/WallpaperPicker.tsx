'use client';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ErrorPanel } from '@/ui/layout/ErrorPanel';
import { Wallpaper, builtInTone, type WallpaperTone } from '@/core/config/wallpapers';
import { useSaveSetting } from './queries';
import { UploadedWallpapers } from './UploadedWallpapers';
import { WallpaperSwatch } from './WallpaperSwatch';
// ADMIN-B42: the workspace wallpaper is chosen by sight, not typed: every wallpaper is a swatch of
// itself with its name under it, and the chosen one carries a ring and a tick. Choosing saves at
// once and repaints the window behind this page, so the administrator sees the choice in place. The
// built-in swatches are one radio group; the administrator's own images (ADMIN-B47) are another
// below them, with the tile that uploads a new one. The accent and an uploaded image are drawn from
// the page's own render (ADR 0037), so a choice re-renders the page as well.
export function WallpaperPicker({ value }: { value: string }) {
  const t = useTranslations('admin');
  const save = useSaveSetting();
  const router = useRouter();
  const current = String(save.variables?.value ?? value);
  const choose = (choice: string, name: string, tone: WallpaperTone) =>
    save.mutate(
      { key: 'workspace.wallpaper', value: choice },
      {
        onSuccess: () => {
          document.documentElement.dataset.wallpaper = name;
          document.documentElement.dataset.wallpaperTone = tone;
          router.refresh();
        },
      },
    );
  return (
    <section className="grid gap-2">
      <div className="grid gap-1">
        <h3 className="text-sm font-medium">{t('wallpaper')}</h3>
        <p className="text-sm font-light text-text-muted">{t('wallpaperDescription')}</p>
      </div>
      <div
        role="radiogroup"
        aria-label={t('wallpaper')}
        className="grid grid-cols-2 gap-3 sm:grid-cols-4"
      >
        {Wallpaper.options.map((wallpaper) => (
          <WallpaperSwatch
            key={wallpaper}
            label={t(`wallpaper_${wallpaper}`)}
            swatch={wallpaper}
            chosen={current === wallpaper}
            busy={save.isPending}
            choose={() => choose(wallpaper, wallpaper, builtInTone[wallpaper])}
          />
        ))}
      </div>
      <UploadedWallpapers
        current={current}
        busy={save.isPending}
        choose={(wallpaper) => choose(wallpaper.id, 'custom', wallpaper.tone)}
      />
      {save.isError && <ErrorPanel error={save.error} />}
    </section>
  );
}
