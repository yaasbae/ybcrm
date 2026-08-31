import { useLayoutEffect, useRef } from 'react';

// Size the inbox from its real position, not a guessed height of the CRM header.
export function useInboxViewport(mobileChat: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const mobile = window.matchMedia('(max-width: 1023px)');
    const viewport = window.visualViewport;
    let frame = 0;
    const update = () => {
      const height = viewport?.height ?? window.innerHeight;
      const offset = viewport?.offsetTop ?? 0;
      const fullscreen = mobile.matches && mobileChat;
      const available = fullscreen ? height : height - Math.max(0, element.getBoundingClientRect().top - offset) - 12;
      element.style.setProperty('--inbox-height', `${Math.max(fullscreen ? 0 : 240, Math.floor(available))}px`);
      element.style.setProperty('--inbox-viewport-top', `${offset}px`);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const observer = new ResizeObserver(schedule);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    mobile.addEventListener('change', schedule);
    update();
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      mobile.removeEventListener('change', schedule);
    };
  }, [mobileChat]);
  useLayoutEffect(() => {
    if (!mobileChat) return;
    const mobile = window.matchMedia('(max-width: 1023px)');
    const previous = document.body.style.overflow;
    const sync = () => { document.body.style.overflow = mobile.matches ? 'hidden' : previous; };
    sync();
    mobile.addEventListener('change', sync);
    return () => {
      document.body.style.overflow = previous;
      mobile.removeEventListener('change', sync);
    };
  }, [mobileChat]);
  return ref;
}
