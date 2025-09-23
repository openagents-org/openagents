import React, { useState, useEffect, useCallback } from 'react';
import { OpenAgentsService } from '../../services/openAgentsService';

interface WikiPage {
  page_path: string;
  title: string;
  wiki_content: string;
  creator_id: string;
  created_at: number;
  last_modified: number;
  version: number;
}

interface WikiEditProposal {
  proposal_id: string;
  page_path: string;
  proposed_content: string;
  rationale: string;
  proposer_id: string;
  created_at: number;
  status: 'pending' | 'approved' | 'rejected';
}

interface WikiViewProps {
  onBackClick?: () => void;
  connection?: OpenAgentsService | null;
}

const WikiView: React.FC<WikiViewProps> = ({
  onBackClick,
  connection
}) => {
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [selectedPage, setSelectedPage] = useState<WikiPage | null>(null);
  const [proposals, setProposals] = useState<WikiEditProposal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreatePage, setShowCreatePage] = useState(false);
  // const [showProposals, setShowProposals] = useState(false); // TODO: Implement proposals view toggle
  const [newPagePath, setNewPagePath] = useState('');
  const [newPageTitle, setNewPageTitle] = useState('');
  const [newPageContent, setNewPageContent] = useState('');
  const [proposalContent, setProposalContent] = useState('');
  const [proposalRationale, setProposalRationale] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentView, setCurrentView] = useState<'list' | 'page' | 'edit' | 'proposals'>('list');

  // Load wiki pages
  const loadPages = useCallback(async () => {
    if (!connection) return;

    try {
      setIsLoading(true);
      setError(null);
      
      const response = await connection.sendEvent({
        event_name: 'wiki.pages.list',
        destination_id: 'mod:openagents.mods.workspace.wiki',
        payload: {
          limit: 50,
          offset: 0
        }
      });

      if (response.success && response.data) {
        setPages(response.data.pages || []);
      } else {
        setError(response.message || 'Failed to load wiki pages');
      }
      setIsLoading(false);
    } catch (err) {
      console.error('Failed to load wiki pages:', err);
      setError('Failed to load wiki pages');
      setIsLoading(false);
    }
  }, [connection]);

  // Load edit proposals
  const loadProposals = useCallback(async () => {
    if (!connection) return;

    try {
      const response = await connection.sendEvent({
        event_name: 'wiki.proposals.list',
        destination_id: 'mod:openagents.mods.workspace.wiki',
        payload: {}
      });

      if (response.success && response.data) {
        setProposals(response.data.proposals || []);
      }
    } catch (err) {
      console.error('Failed to load proposals:', err);
    }
  }, [connection]);

  // Get specific wiki page
  const loadPage = useCallback(async (pagePath: string) => {
    if (!connection) return;

    try {
      const response = await connection.sendEvent({
        event_name: 'wiki.page.get',
        destination_id: 'mod:openagents.mods.workspace.wiki',
        payload: {
          page_path: pagePath
        }
      });

      if (response.success && response.data) {
        setSelectedPage(response.data);
      }
    } catch (err) {
      console.error('Failed to load wiki page:', err);
    }
  }, [connection]);

  // Search wiki pages
  const searchPages = useCallback(async (query: string) => {
    if (!connection || !query.trim()) {
      loadPages();
      return;
    }

    try {
      const response = await connection.sendEvent({
        event_name: 'wiki.pages.search',
        destination_id: 'mod:openagents.mods.workspace.wiki',
        payload: {
          query: query.trim(),
          limit: 50
        }
      });

      if (response.success && response.data) {
        setPages(response.data.pages || []);
      }
    } catch (err) {
      console.error('Failed to search wiki pages:', err);
    }
  }, [connection, loadPages]);

  // Create new wiki page
  const createPage = async () => {
    if (!connection || !newPagePath.trim() || !newPageTitle.trim() || !newPageContent.trim()) return;

    try {
      const response = await connection.sendEvent({
        event_name: 'wiki.page.create',
        destination_id: 'mod:openagents.mods.workspace.wiki',
        payload: {
          page_path: newPagePath.trim(),
          title: newPageTitle.trim(),
          wiki_content: newPageContent.trim()
        }
      });

      if (response.success) {
        setNewPagePath('');
        setNewPageTitle('');
        setNewPageContent('');
        setShowCreatePage(false);
        loadPages(); // Refresh pages list
      } else {
        setError(response.message || 'Failed to create wiki page');
      }
    } catch (err) {
      console.error('Failed to create wiki page:', err);
      setError('Failed to create wiki page');
    }
  };

  // Edit wiki page (direct edit by owner)
  const editPage = async (pagePath: string, content: string) => {
    if (!connection || !content.trim()) return;

    try {
      const response = await connection.sendEvent({
        event_name: 'wiki.page.edit',
        destination_id: 'mod:openagents.mods.workspace.wiki',
        payload: {
          page_path: pagePath,
          wiki_content: content.trim()
        }
      });

      if (response.success) {
        loadPage(pagePath); // Refresh page
        loadPages(); // Refresh pages list
        setCurrentView('page');
      } else {
        setError(response.message || 'Failed to edit wiki page');
      }
    } catch (err) {
      console.error('Failed to edit wiki page:', err);
      setError('Failed to edit wiki page');
    }
  };

  // Propose edit to wiki page
  const proposeEdit = async (pagePath: string, content: string, rationale: string) => {
    if (!connection || !content.trim() || !rationale.trim()) return;

    // Validate parameters
    if (!pagePath || !pagePath.trim()) {
      setError('Page path is required for proposals');
      return;
    }

    try {
      const payload = {
        page_path: pagePath.trim(),
        wiki_content: content.trim(),
        rationale: rationale.trim()
      };

      console.log('Sending proposal event with payload:', payload);

      const response = await connection.sendEvent({
        event_name: 'wiki.page.proposal.create',
        destination_id: 'mod:openagents.mods.workspace.wiki',
        payload: payload
      });

      if (response.success) {
        setProposalContent('');
        setProposalRationale('');
        setCurrentView('page');
        loadProposals(); // Refresh proposals
      } else {
        setError(response.message || 'Failed to propose edit');
      }
    } catch (err) {
      console.error('Failed to propose edit:', err);
      setError('Failed to propose edit');
    }
  };

  // Resolve edit proposal
  const resolveProposal = async (proposalId: string, action: 'approve' | 'reject') => {
    if (!connection) return;

    try {
      const response = await connection.sendEvent({
        event_name: 'wiki.proposal.resolve',
        destination_id: 'mod:openagents.mods.workspace.wiki',
        payload: {
          proposal_id: proposalId,
          action: action
        }
      });

      if (response.success) {
        loadProposals(); // Refresh proposals
        loadPages(); // Refresh pages in case of approval
      } else {
        setError(response.message || `Failed to ${action} proposal`);
      }
    } catch (err) {
      console.error(`Failed to ${action} proposal:`, err);
      setError(`Failed to ${action} proposal`);
    }
  };

  // Initialize - only load when connection is available and ready
  useEffect(() => {
    if (connection) {
      console.log('WikiView: Connection available, waiting for connection to stabilize...');
      // Add a small delay to ensure the connection is fully established
      const timer = setTimeout(() => {
        console.log('WikiView: Connection stabilized, loading pages...');
        loadPages();
        loadProposals();
      }, 500); // 500ms delay
      
      return () => clearTimeout(timer);
    } else {
      console.log('WikiView: No connection, waiting...');
      setIsLoading(false); // Stop loading if no connection
    }
  }, [connection, loadPages, loadProposals]);

  // Handle search
  useEffect(() => {
    const timeoutId = setTimeout(() => {
      searchPages(searchQuery);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [searchQuery, searchPages]);

  if (isLoading || !connection) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-600 dark:text-gray-400">
            {!connection ? 'Connecting to network...' : 'Loading wiki...'}
          </p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 mb-4">
            <svg className="w-16 h-16 mx-auto" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} 
                    d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.864-.833-2.634 0L4.268 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h3 className="text-lg font-medium mb-2 text-gray-800 dark:text-gray-200">
            Wiki Error
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {error}
          </p>
          <button
            onClick={onBackClick}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Back to Chat
          </button>
        </div>
      </div>
    );
  }

  // Page detail view
  if (currentView === 'page' && selectedPage) {
    const isOwner = selectedPage.creator_id === connection?.getAgentId();

    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-3 mb-4">
            <button
              onClick={() => {
                setSelectedPage(null);
                setCurrentView('list');
              }}
              className="p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div className="flex-1">
              <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
                {selectedPage.title || 'Untitled'}
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                {selectedPage.page_path || 'Unknown path'} • by {selectedPage.creator_id || 'Unknown'} • v{selectedPage.version || 1}
              </p>
            </div>
            <div className="flex space-x-2">
              {isOwner ? (
                <button
                  onClick={() => setCurrentView('edit')}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  Edit
                </button>
              ) : (
                <button
                  onClick={() => setCurrentView('edit')}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                >
                  Propose Edit
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="prose max-w-none dark:prose-invert">
            <div className="whitespace-pre-wrap text-gray-700 dark:text-gray-300">
              {selectedPage.wiki_content || 'No content available'}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Edit/Propose view
  if (currentView === 'edit' && selectedPage) {
    const isOwner = selectedPage.creator_id === connection?.getAgentId();

    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setCurrentView('page')}
              className="p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
              {isOwner ? 'Edit Page' : 'Propose Edit'}: {selectedPage.title}
            </h1>
          </div>
        </div>

        {/* Edit form */}
        <div className="flex-1 flex flex-col p-6 space-y-4">
          <div className="flex-1">
            <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
              Content
            </label>
            <textarea
              value={proposalContent || selectedPage.wiki_content}
              onChange={(e) => setProposalContent(e.target.value)}
              className="w-full h-full p-4 rounded-lg border resize-none bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
              placeholder="Enter page content..."
            />
          </div>
          
          {!isOwner && (
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700 dark:text-gray-300">
                Rationale for Change
              </label>
              <textarea
                value={proposalRationale}
                onChange={(e) => setProposalRationale(e.target.value)}
                className="w-full p-3 rounded-lg border resize-none bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
                rows={3}
                placeholder="Explain why you want to make this change..."
              />
            </div>
          )}

          <div className="flex justify-end space-x-3">
            <button
              onClick={() => setCurrentView('page')}
              className="px-4 py-2 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              Cancel
            </button>
            <button
              onClick={() => {
                if (isOwner) {
                  editPage(selectedPage.page_path, proposalContent || selectedPage.wiki_content);
                } else {
                  proposeEdit(selectedPage.page_path, proposalContent || selectedPage.wiki_content, proposalRationale);
                }
              }}
              disabled={!isOwner && !proposalRationale.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isOwner ? 'Save Changes' : 'Submit Proposal'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Proposals view
  if (currentView === 'proposals') {
    return (
      <div className="h-full flex flex-col">
        {/* Header */}
        <div className="border-b border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center space-x-3">
            <button
              onClick={() => setCurrentView('list')}
              className="p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
              Edit Proposals
            </h1>
          </div>
        </div>

        {/* Proposals list */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-4">
            {proposals.filter(p => p.status === 'pending').map((proposal) => (
              <div
                key={proposal.proposal_id}
                className="p-4 rounded-lg border bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-semibold text-gray-800 dark:text-gray-200">
                      {proposal.page_path}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      by {proposal.proposer_id} • {new Date(proposal.created_at * 1000).toLocaleString()}
                    </p>
                  </div>
                  <div className="flex space-x-2">
                    <button
                      onClick={() => resolveProposal(proposal.proposal_id, 'approve')}
                      className="px-3 py-1 text-sm bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => resolveProposal(proposal.proposal_id, 'reject')}
                      className="px-3 py-1 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
                <div className="text-sm mb-2 text-gray-700 dark:text-gray-300">
                  <strong>Rationale:</strong> {proposal.rationale}
                </div>
                <div className="text-xs p-2 rounded bg-gray-100 dark:bg-gray-700">
                  <div className="text-gray-600 dark:text-gray-400 mb-1">
                    Proposed content:
                  </div>
                  <div className="whitespace-pre-wrap text-sm text-gray-700 dark:text-gray-300">
                    {proposal.proposed_content ? proposal.proposed_content.substring(0, 200) : 'No content'}
                    {proposal.proposed_content && proposal.proposed_content.length > 200 && '...'}
                  </div>
                </div>
              </div>
            ))}
            {proposals.filter(p => p.status === 'pending').length === 0 && (
              <div className="text-center py-8">
                <p className="text-gray-600 dark:text-gray-400">
                  No pending proposals
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Pages list view (default)
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center space-x-3">
            <button
              onClick={onBackClick}
              className="p-2 rounded-lg transition-colors hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-200">
                Wiki
              </h1>
              <p className="text-sm text-gray-600 dark:text-gray-400">
                Collaborative knowledge base
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-3">
            {proposals.filter(p => p.status === 'pending').length > 0 && (
              <button
                onClick={() => setCurrentView('proposals')}
                className="flex items-center space-x-2 px-4 py-2 bg-yellow-600 text-white rounded-lg hover:bg-yellow-700 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>Proposals ({proposals.filter(p => p.status === 'pending').length})</span>
              </button>
            )}
            <button
              onClick={() => setShowCreatePage(true)}
              className="flex items-center space-x-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              <span>New Page</span>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search wiki pages..."
            className="w-full pl-10 pr-4 py-2 rounded-lg border bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
          />
          <svg className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500 dark:text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Pages list */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="space-y-4">
          {pages.map((page) => (
            <div
              key={page.page_path}
              onClick={() => {
                setSelectedPage(page);
                setCurrentView('page');
                loadPage(page.page_path);
              }}
              className="p-4 rounded-lg border cursor-pointer transition-colors bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-750"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-lg font-semibold mb-2 text-gray-800 dark:text-gray-200">
                    {page.title || 'Untitled'}
                  </h3>
                  <p className="text-sm mb-3 line-clamp-2 text-gray-600 dark:text-gray-400">
                    {page.wiki_content ? page.wiki_content.substring(0, 150) : 'No content'}
                    {page.wiki_content && page.wiki_content.length > 150 && '...'}
                  </p>
                  <div className="flex items-center space-x-4 text-sm text-gray-600 dark:text-gray-400">
                    <span>{page.page_path || 'Unknown path'}</span>
                    <span>by {page.creator_id || 'Unknown'}</span>
                    <span>v{page.version || 1}</span>
                    <span>{page.last_modified ? new Date(page.last_modified * 1000).toLocaleDateString() : 'Unknown date'}</span>
                  </div>
                </div>
              </div>
            </div>
          ))}
          {pages.length === 0 && (
            <div className="text-center py-8">
              <p className="text-gray-600 dark:text-gray-400">
                {searchQuery ? 'No pages found matching your search' : 'No wiki pages yet'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Create page modal */}
      {showCreatePage && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="w-full max-w-2xl mx-4 p-6 rounded-lg bg-white dark:bg-gray-800">
            <h2 className="text-xl font-bold mb-4 text-gray-800 dark:text-gray-200">
              Create New Wiki Page
            </h2>
            <div className="space-y-4">
              <input
                type="text"
                value={newPagePath}
                onChange={(e) => setNewPagePath(e.target.value)}
                placeholder="Page path (e.g., /getting-started)"
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
              />
              <input
                type="text"
                value={newPageTitle}
                onChange={(e) => setNewPageTitle(e.target.value)}
                placeholder="Page title..."
                className="w-full p-3 rounded-lg border bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
              />
              <textarea
                value={newPageContent}
                onChange={(e) => setNewPageContent(e.target.value)}
                placeholder="Page content..."
                className="w-full p-3 rounded-lg border resize-none bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-200 placeholder-gray-500 dark:placeholder-gray-400"
                rows={8}
              />
            </div>
            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowCreatePage(false)}
                className="px-4 py-2 rounded-lg transition-colors text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={createPage}
                disabled={!newPagePath.trim() || !newPageTitle.trim() || !newPageContent.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Create Page
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default WikiView;