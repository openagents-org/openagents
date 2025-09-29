import requests
import json
import os
import time
from datetime import datetime, timedelta
from typing import List, Dict, Set
import xml.etree.ElementTree as ET
from urllib.parse import urlencode


class ArxivFetcher:
    """Fetches new AI papers from ArXiv with tracking to avoid duplicates."""
    
    def __init__(self, tracking_file: str = "/tmp/arxiv_fetched_papers.json"):
        self.tracking_file = tracking_file
        self.base_url = "http://export.arxiv.org/api/query"
        self.ai_categories = [
            "cs.AI",  # Artificial Intelligence
            "cs.LG",  # Machine Learning
            "cs.CL",  # Computation and Language (NLP)
            "cs.CV",  # Computer Vision
            "cs.NE",  # Neural and Evolutionary Computing
            "stat.ML"  # Machine Learning (Statistics)
        ]
        self.fetched_papers = self._load_tracking_file()
    
    def _load_tracking_file(self) -> Set[str]:
        """Load previously fetched paper IDs from tracking file."""
        if os.path.exists(self.tracking_file):
            try:
                with open(self.tracking_file, 'r') as f:
                    data = json.load(f)
                    return set(data.get('fetched_papers', []))
            except (json.JSONDecodeError, IOError):
                return set()
        return set()
    
    def _save_tracking_file(self):
        """Save fetched paper IDs to tracking file."""
        try:
            os.makedirs(os.path.dirname(self.tracking_file), exist_ok=True)
            data = {
                'fetched_papers': list(self.fetched_papers),
                'last_updated': datetime.now().isoformat()
            }
            with open(self.tracking_file, 'w') as f:
                json.dump(data, f, indent=2)
        except IOError as e:
            print(f"Warning: Could not save tracking file: {e}")
    
    def _build_query(self, categories: List[str], max_results: int = 100, 
                    days_back: int = 7) -> str:
        """Build ArXiv API query string for AI-related papers."""
        # Create category query
        cat_query = " OR ".join([f"cat:{cat}" for cat in categories])
        
        # Add AI-related keywords to catch papers in other categories
        ai_keywords = [
            "artificial intelligence", "machine learning", "deep learning",
            "neural network", "natural language processing", "computer vision",
            "reinforcement learning", "transformer", "llm", "large language model"
        ]
        keyword_query = " OR ".join([f'all:"{keyword}"' for keyword in ai_keywords])
        
        # Combine category and keyword queries
        full_query = f"({cat_query}) OR ({keyword_query})"
        
        params = {
            'search_query': full_query,
            'start': 0,
            'max_results': max_results,
            'sortBy': 'submittedDate',
            'sortOrder': 'descending'
        }
        
        return f"{self.base_url}?{urlencode(params)}"
    
    def _parse_arxiv_response(self, xml_content: str) -> List[Dict]:
        """Parse ArXiv API XML response into structured data."""
        papers = []
        
        try:
            root = ET.fromstring(xml_content)
            
            # Define namespace
            ns = {'atom': 'http://www.w3.org/2005/Atom',
                  'arxiv': 'http://arxiv.org/schemas/atom'}
            
            entries = root.findall('atom:entry', ns)
            
            for entry in entries:
                paper_id = entry.find('atom:id', ns).text.split('/')[-1]
                
                # Skip if already fetched
                if paper_id in self.fetched_papers:
                    continue
                
                title = entry.find('atom:title', ns).text.strip()
                summary = entry.find('atom:summary', ns).text.strip()
                published = entry.find('atom:published', ns).text
                updated = entry.find('atom:updated', ns).text
                
                # Get authors
                authors = []
                for author in entry.findall('atom:author', ns):
                    name = author.find('atom:name', ns).text
                    authors.append(name)
                
                # Get categories
                categories = []
                for category in entry.findall('atom:category', ns):
                    categories.append(category.get('term'))
                
                # Get PDF link
                pdf_link = None
                for link in entry.findall('atom:link', ns):
                    if link.get('type') == 'application/pdf':
                        pdf_link = link.get('href')
                        break
                
                paper = {
                    'id': paper_id,
                    'title': title,
                    'summary': summary,
                    'authors': authors,
                    'categories': categories,
                    'published': published,
                    'updated': updated,
                    'pdf_url': pdf_link,
                    'arxiv_url': f"https://arxiv.org/abs/{paper_id}"
                }
                
                papers.append(paper)
                self.fetched_papers.add(paper_id)
        
        except ET.ParseError as e:
            print(f"Error parsing XML response: {e}")
        
        return papers
    
    def fetch_new_list(self, max_results: int = 50, days_back: int = 7) -> List[Dict]:
        """
        Fetch new AI papers from ArXiv that haven't been returned before.
        
        Args:
            max_results: Maximum number of papers to fetch
            days_back: How many days back to search (not strictly enforced by ArXiv API)
            
        Returns:
            List of paper dictionaries with metadata
        """
        try:
            query_url = self._build_query(self.ai_categories, max_results, days_back)
            
            # Add delay to be respectful to ArXiv API
            time.sleep(1)
            
            response = requests.get(query_url, timeout=30)
            response.raise_for_status()
            
            new_papers = self._parse_arxiv_response(response.text)
            
            # Save tracking file if we found new papers
            if new_papers:
                self._save_tracking_file()
                print(f"Fetched {len(new_papers)} new AI papers from ArXiv")
            else:
                print("No new AI papers found")
            
            return new_papers
            
        except requests.RequestException as e:
            print(f"Error fetching from ArXiv API: {e}")
            return []
        except Exception as e:
            print(f"Unexpected error: {e}")
            return []
    
    def reset_tracking(self):
        """Reset the tracking file to fetch all papers again."""
        self.fetched_papers.clear()
        if os.path.exists(self.tracking_file):
            os.remove(self.tracking_file)
        print("Tracking file reset")
    
    def get_tracking_stats(self) -> Dict:
        """Get statistics about tracked papers."""
        return {
            'total_fetched': len(self.fetched_papers),
            'tracking_file': self.tracking_file,
            'tracking_file_exists': os.path.exists(self.tracking_file)
        }


if __name__ == "__main__":
    # Example usage
    fetcher = ArxivFetcher()
    
    # Fetch new papers
    papers = fetcher.fetch_new_list(max_results=10)
    
    for paper in papers:
        print(f"Title: {paper['title']}")
        print(f"Authors: {', '.join(paper['authors'])}")
        print(f"Categories: {', '.join(paper['categories'])}")
        print(f"ArXiv URL: {paper['arxiv_url']}")
        print("-" * 80)
    
    # Show tracking stats
    stats = fetcher.get_tracking_stats()
    print(f"Tracking stats: {stats}")