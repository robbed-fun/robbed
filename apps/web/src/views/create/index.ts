/**
 * Public API for the Create screen (FSD `pages` layer, renamed `views` to avoid
 * the Next `pages` collision). Route renamed /launch → /create by the ROBBED_
 * redesign (user-directed; recorded as a spec deviation for). The Next
 * route file (`app/create/page.tsx`) re-exports this default; /launch redirects
 * here via next.config redirects.
 */
export { default } from "./ui/CreateView";
