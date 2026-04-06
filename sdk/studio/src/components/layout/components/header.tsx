import { HeaderBreadcrumbs } from './header-breadcrumbs';
import { HeaderToolbar } from './header-toolbar';
import { useLayout } from './context';
import { HeaderMenu } from './header-menu';

export function Header() {
  const { isMobile } = useLayout();
  
  return (
    <header className="flex items-stretch fixed z-10 lg:border-t transition-[left,right] duration-300 start-0 lg:rounded-se-xl lg:in-data-[sidebar-open=false]:rounded-ss-xl lg:in-data-[sidebar-open=false]:border-s lg:border-e border-border top-0 lg:top-(--page-margin) end-0 lg:end-(--page-margin) lg:start-(--sidebar-width) lg:in-data-[sidebar-open=false]:start-(--sidebar-collapsed-width) shrink-0 bg-background border-b backdrop-blur-sm h-(--header-height-mobile) lg:h-(--header-height) pe-[var(--removed-body-scroll-bar-size,0px)]">
      <div className="container-fluid grow flex items-stretch justify-between gap-2.5">
        {isMobile && <HeaderMenu />}
        {!isMobile && <HeaderBreadcrumbs />}
        <HeaderToolbar />
      </div>
    </header>
  );
}
