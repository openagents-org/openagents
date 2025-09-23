/**
 * ForumView 重构通知
 *
 * 原来的 ForumView 组件已经被重构为模块化架构：
 * - ForumTopicList: 话题列表页面
 * - ForumTopicDetail: 话题详情页面
 * - ForumMainPage: 负责路由配置
 *
 * 如果你需要访问原来的组件，请查看 ForumView.tsx.backup
 */

// 为了保持向后兼容，导出 ForumTopicList 作为默认组件
export { default } from './ForumTopicList';