/**
 * ForumView Refactoring notice
 *
 * 原来的 ForumView 组件已经被重构为模块化架构：
 * - ForumTopicList: Topic list page
 * - ForumTopicDetail: Topic detail page
 * - ForumMainPage: Responsible for route configuration
 *
 * If you need to access the original component, see ForumView.tsx.backup
 */

// For backward compatibility, export ForumTopicList as default component
export { default } from './ForumTopicList';