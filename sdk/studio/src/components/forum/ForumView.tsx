/**
 * ForumView Refactoring notice
 *
 * Original ForumView component has been refactored to modular architecture:
 * - ForumTopicList: Topic list page
 * - ForumTopicDetail: Topic detail page
 * - ForumMainPage: Responsible for route configuration
 *
 * If you need to access the original component, see ForumView.tsx.backup
 */

// For backward compatibility, export ForumTopicList as default component
export { default } from './ForumTopicList';