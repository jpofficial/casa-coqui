'use client';

import { useState, useEffect, useRef } from 'react';
import { getArticlesForPage, getAllArticles, searchArticles } from '@/lib/help-articles';
import {
  HomeScreen, CheckinScreen, AccessScreen, BottomNavScreen,
  MaintenanceScreen, MaintenanceSuccessScreen, LaundryScreen,
  CommunityScreen, InviteScreen, ParkingScreen, RulesScreen,
} from '@/components/ui/ScreenMockup';

// ─── Screen component registry ──────────────────────────────────────────────
const SCREEN_COMPONENTS = {
  HomeScreen, CheckinScreen, AccessScreen, BottomNavScreen,
  MaintenanceScreen, MaintenanceSuccessScreen, LaundryScreen,
  CommunityScreen, InviteScreen, ParkingScreen, RulesScreen,
};

// ─── Article body renderer ──────────────────────────────────────────────────
function ArticleBody({ body }) {
  return (
    <div className="space-y-3">
      {body.map((block, i) => {
        switch (block.type) {
          case 'text':
            return (
              <p key={i} className="text-sm text-gray-700 leading-relaxed">
                {block.content}
              </p>
            );
          case 'heading':
            return (
              <h4 key={i} className="text-sm font-semibold text-gray-900 mt-2">
                {block.content}
              </h4>
            );
          case 'step':
            return (
              <div key={i} className="flex gap-3 text-sm text-gray-700">
                <span className="flex-none w-5 h-5 rounded-full bg-green-100 text-green-700 text-xs font-semibold flex items-center justify-center mt-0.5">
                  {block.number}
                </span>
                <span className="leading-relaxed">{block.content}</span>
              </div>
            );
          case 'screen': {
            const ScreenComp = SCREEN_COMPONENTS[block.component];
            if (!ScreenComp) return null;
            return <ScreenComp key={i} {...(block.props || {})} />;
          }
          case 'tip':
            return (
              <div key={i} className="flex gap-2.5 bg-green-50 border border-green-100 rounded-lg px-3 py-2.5">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-600 flex-none mt-0.5">
                  <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
                </svg>
                <p className="text-xs text-green-800 leading-relaxed">{block.content}</p>
              </div>
            );
          case 'trouble':
            return (
              <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                <p className="text-xs font-semibold text-amber-800 mb-1">{block.title}</p>
                <p className="text-xs text-amber-700 leading-relaxed">{block.content}</p>
              </div>
            );
          default:
            return null;
        }
      })}
    </div>
  );
}

// ─── Single article card ────────────────────────────────────────────────────
function ArticleCard({ article, onSelect }) {
  return (
    <button
      onClick={() => onSelect(article)}
      className="w-full text-left bg-white rounded-xl shadow-sm border border-gray-100 p-3.5 hover:shadow-md hover:border-gray-200 transition-all active:scale-[0.98] group"
    >
      <p className="text-sm font-semibold text-gray-900 group-hover:text-green-700 transition-colors">
        {article.title}
      </p>
      <p className="text-xs text-gray-500 mt-0.5 leading-relaxed">
        {article.summary}
      </p>
    </button>
  );
}

// ─── Article detail view ────────────────────────────────────────────────────
function ArticleDetail({ article, onBack }) {
  return (
    <div className="animate-fade-in">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-green-600 hover:text-green-700 font-medium mb-4 transition-colors"
      >
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
          <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 01-.02 1.06L8.832 10l3.938 3.71a.75.75 0 11-1.04 1.08l-4.5-4.25a.75.75 0 010-1.08l4.5-4.25a.75.75 0 011.06.02z" clipRule="evenodd" />
        </svg>
        Back
      </button>

      <h3 className="text-base font-semibold text-gray-900 mb-1">
        {article.title}
      </h3>
      <p className="text-xs text-gray-500 mb-4">{article.summary}</p>

      <ArticleBody body={article.body} />
    </div>
  );
}

// ─── Main HelpDrawer component ──────────────────────────────────────────────
export default function HelpDrawer({ isOpen, onClose, pageKey }) {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedArticle, setSelectedArticle] = useState(null);
  const drawerRef = useRef(null);
  const searchRef = useRef(null);

  // Reset state when drawer closes
  useEffect(() => {
    if (!isOpen) {
      // Small delay to let animation finish before resetting
      const t = setTimeout(() => {
        setSearchTerm('');
        setSelectedArticle(null);
      }, 300);
      return () => clearTimeout(t);
    } else if (searchRef.current) {
      // Focus search on open (after animation)
      const t = setTimeout(() => searchRef.current?.focus(), 350);
      return () => clearTimeout(t);
    }
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  // Prevent body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [isOpen]);

  // Determine which articles to show
  const contextArticles = getArticlesForPage(pageKey);
  const allArticles = getAllArticles();
  const results = searchTerm.length >= 2 ? searchArticles(searchTerm) : null;

  const displayArticles = results || contextArticles;
  const showingSearch = results !== null;

  return (
    <>
      {/* Backdrop overlay */}
      <div
        className={`fixed inset-0 bg-black/30 z-[60] transition-opacity duration-300 ${
          isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer panel */}
      <div
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Help"
        className={`fixed top-0 right-0 h-full w-full sm:w-96 bg-white shadow-xl z-[70] transform transition-transform duration-300 ease-out flex flex-col ${
          isOpen ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        {/* ── Header ──────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-4 h-14 border-b border-gray-100 flex-none">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-green-600">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.06-1.06 3.5 3.5 0 014.753.45A3.5 3.5 0 0113.5 9.5a2.25 2.25 0 01-2.25 2.25.75.75 0 01-.75-.75v-1a.75.75 0 01.75-.75A.75.75 0 0012 8.5a2 2 0 00-3.06-1.56zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <h2 className="text-base font-semibold text-gray-900">Help</h2>
          </div>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-8 h-8 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors"
            aria-label="Close help"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-gray-400">
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </div>

        {/* ── Search ──────────────────────────────────────────── */}
        <div className="px-4 pt-3 pb-2 flex-none">
          <div className="relative">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2">
              <path fillRule="evenodd" d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z" clipRule="evenodd" />
            </svg>
            <input
              ref={searchRef}
              type="text"
              placeholder="Search help articles..."
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setSelectedArticle(null);
              }}
              className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-green-500/20 focus:border-green-500 transition-colors"
            />
            {searchTerm && (
              <button
                onClick={() => { setSearchTerm(''); setSelectedArticle(null); }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                aria-label="Clear search"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="w-3.5 h-3.5">
                  <path d="M5.28 4.22a.75.75 0 00-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 101.06 1.06L8 9.06l2.72 2.72a.75.75 0 101.06-1.06L9.06 8l2.72-2.72a.75.75 0 00-1.06-1.06L8 6.94 5.28 4.22z" />
                </svg>
              </button>
            )}
          </div>
        </div>

        {/* ── Content ─────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 pb-6">
          {selectedArticle ? (
            <ArticleDetail
              article={selectedArticle}
              onBack={() => setSelectedArticle(null)}
            />
          ) : (
            <>
              {/* Section label */}
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2.5 mt-1">
                {showingSearch
                  ? `${displayArticles.length} result${displayArticles.length !== 1 ? 's' : ''}`
                  : 'Helpful for this page'
                }
              </p>

              {/* Article cards */}
              {displayArticles.length > 0 ? (
                <div className="space-y-2">
                  {displayArticles.map((article) => (
                    <ArticleCard
                      key={article.id}
                      article={article}
                      onSelect={setSelectedArticle}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8">
                  <p className="text-sm text-gray-400">No articles found.</p>
                  <p className="text-xs text-gray-400 mt-1">Try a different search term.</p>
                </div>
              )}

              {/* All articles section (when not searching) */}
              {!showingSearch && (
                <>
                  <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2.5 mt-6">
                    All help topics
                  </p>
                  <div className="space-y-2">
                    {allArticles
                      .filter(a => !contextArticles.find(c => c.id === a.id))
                      .map((article) => (
                        <ArticleCard
                          key={article.id}
                          article={article}
                          onSelect={setSelectedArticle}
                        />
                      ))}
                  </div>
                </>
              )}
            </>
          )}
        </div>

        {/* ── Footer CTA ──────────────────────────────────────── */}
        <div className="flex-none px-4 py-3 border-t border-gray-100 bg-gray-50/80">
          <p className="text-[11px] text-gray-400 text-center">
            Need more help? Contact your host through Airbnb.
          </p>
        </div>
      </div>

      {/* Inline animation style */}
      <style jsx>{`
        .animate-fade-in {
          animation: helpFadeIn 0.2s ease-out both;
        }
        @keyframes helpFadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </>
  );
}
