/**
 * `next/navigation`, for the desktop build.
 *
 * Aliased in vite.config.ts, so the pages' own imports resolve here without a
 * line of theirs changing. The implementations live in the router next door.
 */
export {
  useRouter,
  usePathname,
  useSearchParams,
  useParams,
} from '../router';
