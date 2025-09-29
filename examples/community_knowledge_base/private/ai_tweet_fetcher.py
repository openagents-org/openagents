import requests
import json
import os
import time
from datetime import datetime, timedelta
from typing import List, Dict, Set, Optional


class AITweetFetcher:
    """Fetches new AI-related tweets from famous influencers with tracking to avoid duplicates."""
    
    def __init__(self, tracking_file: str = "/tmp/ai_tweets_fetched.json", api_key: Optional[str] = None):
        self.tracking_file = tracking_file
        self.api_key = api_key or os.getenv('TWITTER_API_KEY')
        self.bearer_token = os.getenv('TWITTER_BEARER_TOKEN')
        
        # Famous AI influencers and researchers (Twitter usernames)
        self.ai_influencers = [
            "ylecun",          # Yann LeCun
            "AndrewYNg",       # Andrew Ng
            "karpathy",        # Andrej Karpathy
            "fchollet",        # François Chollet
            "GaryMarcus",      # Gary Marcus
            "JeffDean",        # Jeff Dean (Google)
            "sama",            # Sam Altman
            "gdb",             # Greg Brockman
            "ilyasut",         # Ilya Sutskever
            "demishassabis",   # Demis Hassabis (DeepMind)
            "goodfellow_ian",  # Ian Goodfellow
            "jeremyphoward",   # Jeremy Howard
            "tegmark",         # Max Tegmark
            "elonmusk",        # Elon Musk
            "sundarpichai",    # Sundar Pichai
            "satyanadella",    # Satya Nadella
            "lexfridman",      # Lex Fridman
            "mrdbourke",       # Daniel Bourke
            "hardmaru",        # David Ha
            "ch402",           # Christopher Olah
            "AnimaAnandkumar", # Anima Anandkumar
            "pmddomingos",     # Pedro Domingos
            "SebastienBubeck", # Sebastien Bubeck
            "EmilWallner",     # Emil Wallner
            "AranKomatsuzaki", # Aran Komatsuzaki
        ]
        
        # AI-related keywords for filtering
        self.ai_keywords = [
            "artificial intelligence", "machine learning", "deep learning", "AI",
            "neural network", "transformer", "GPT", "LLM", "large language model",
            "computer vision", "NLP", "natural language processing", "OpenAI",
            "reinforcement learning", "generative AI", "ChatGPT", "claude",
            "diffusion", "stable diffusion", "midjourney", "DALL-E", "AGI",
            "artificial general intelligence", "ML", "pytorch", "tensorflow"
        ]
        
        self.fetched_tweets = self._load_tracking_file()
    
    def _load_tracking_file(self) -> Set[str]:
        """Load previously fetched tweet IDs from tracking file."""
        if os.path.exists(self.tracking_file):
            try:
                with open(self.tracking_file, 'r') as f:
                    data = json.load(f)
                    return set(data.get('fetched_tweets', []))
            except (json.JSONDecodeError, IOError):
                return set()
        return set()
    
    def _save_tracking_file(self):
        """Save fetched tweet IDs to tracking file."""
        try:
            os.makedirs(os.path.dirname(self.tracking_file), exist_ok=True)
            data = {
                'fetched_tweets': list(self.fetched_tweets),
                'last_updated': datetime.now().isoformat(),
                'total_influencers': len(self.ai_influencers)
            }
            with open(self.tracking_file, 'w') as f:
                json.dump(data, f, indent=2)
        except IOError as e:
            print(f"Warning: Could not save tracking file: {e}")
    
    def _get_twitter_headers(self) -> Dict[str, str]:
        """Get Twitter API headers."""
        if self.bearer_token:
            return {
                'Authorization': f'Bearer {self.bearer_token}',
                'Content-Type': 'application/json'
            }
        else:
            return {}
    
    def _contains_ai_keywords(self, text: str) -> bool:
        """Check if tweet text contains AI-related keywords."""
        text_lower = text.lower()
        return any(keyword.lower() in text_lower for keyword in self.ai_keywords)
    
    def _fetch_user_tweets_api(self, username: str, max_results: int = 10) -> List[Dict]:
        """
        Fetch tweets from a specific user using Twitter API v2.
        This requires a Twitter Bearer Token.
        """
        if not self.bearer_token:
            raise ValueError(f"Twitter Bearer Token is required. Set TWITTER_BEARER_TOKEN environment variable.")
        
        headers = self._get_twitter_headers()
        
        # Twitter API v2 endpoint for user tweets
        url = f"https://api.twitter.com/2/users/by/username/{username}"
        
        try:
            # First get user ID
            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code != 200:
                print(f"Failed to get user ID for {username}: {response.status_code} - {response.text}")
                return []
            
            user_data = response.json()
            if 'data' not in user_data:
                print(f"No user data found for {username}")
                return []
                
            user_id = user_data['data']['id']
            
            # Then get user's tweets
            tweets_url = f"https://api.twitter.com/2/users/{user_id}/tweets"
            params = {
                'max_results': min(max_results, 100),
                'tweet.fields': 'created_at,public_metrics,author_id',
                'user.fields': 'username,name',
                'exclude': 'retweets,replies'  # Only get original tweets
            }
            
            response = requests.get(tweets_url, headers=headers, params=params, timeout=10)
            
            if response.status_code != 200:
                print(f"Failed to get tweets for {username}: {response.status_code} - {response.text}")
                return []
            
            data = response.json()
            tweets = []
            
            for tweet in data.get('data', []):
                tweet_id = tweet['id']
                
                # Skip if already fetched
                if tweet_id in self.fetched_tweets:
                    continue
                
                # Filter for AI-related content
                if not self._contains_ai_keywords(tweet['text']):
                    continue
                
                formatted_tweet = {
                    'id': tweet_id,
                    'text': tweet['text'],
                    'author_username': username,
                    'author_name': user_data['data'].get('name', username.title()),
                    'created_at': tweet['created_at'],
                    'public_metrics': tweet.get('public_metrics', {}),
                    'url': f"https://twitter.com/{username}/status/{tweet_id}"
                }
                
                tweets.append(formatted_tweet)
                self.fetched_tweets.add(tweet_id)
            
            return tweets
            
        except requests.RequestException as e:
            print(f"API request failed for {username}: {e}")
            return []
    
    def fetch_new_list(self, max_results: int = 50, max_per_user: int = 5) -> List[Dict]:
        """
        Fetch new AI-related tweets from famous influencers.
        
        Args:
            max_results: Maximum total number of tweets to return
            max_per_user: Maximum number of tweets per influencer
            
        Returns:
            List of tweet dictionaries with metadata
        """
        if not self.bearer_token:
            raise ValueError("Twitter Bearer Token is required. Set TWITTER_BEARER_TOKEN environment variable.")
        
        all_tweets = []
        
        # Process influencers in order
        for username in self.ai_influencers:
            if len(all_tweets) >= max_results:
                break
            
            print(f"Fetching tweets from @{username}...")
            
            try:
                # Add delay to be respectful to APIs
                time.sleep(1)
                
                user_tweets = self._fetch_user_tweets_api(username, max_per_user)
                all_tweets.extend(user_tweets[:max_per_user])
                
                if user_tweets:
                    print(f"  Found {len(user_tweets)} AI-related tweets from @{username}")
                
            except Exception as e:
                print(f"Error fetching tweets from @{username}: {e}")
                continue
        
        # Sort by creation time (most recent first)
        all_tweets.sort(key=lambda x: x['created_at'], reverse=True)
        
        # Limit to max_results
        final_tweets = all_tweets[:max_results]
        
        # Save tracking file if we found new tweets
        if final_tweets:
            self._save_tracking_file()
            print(f"\nFetched {len(final_tweets)} new AI-related tweets from {len(set(t['author_username'] for t in final_tweets))} influencers")
        else:
            print("No new AI-related tweets found")
        
        return final_tweets
    
    def reset_tracking(self):
        """Reset the tracking file to fetch all tweets again."""
        self.fetched_tweets.clear()
        if os.path.exists(self.tracking_file):
            os.remove(self.tracking_file)
        print("Tweet tracking file reset")
    
    def get_tracking_stats(self) -> Dict:
        """Get statistics about tracked tweets."""
        return {
            'total_fetched': len(self.fetched_tweets),
            'tracking_file': self.tracking_file,
            'tracking_file_exists': os.path.exists(self.tracking_file),
            'total_influencers': len(self.ai_influencers),
            'has_bearer_token': bool(self.bearer_token)
        }
    
    def add_influencer(self, username: str):
        """Add a new influencer to track."""
        if username not in self.ai_influencers:
            self.ai_influencers.append(username)
            print(f"Added @{username} to influencer list")
    
    def remove_influencer(self, username: str):
        """Remove an influencer from tracking."""
        if username in self.ai_influencers:
            self.ai_influencers.remove(username)
            print(f"Removed @{username} from influencer list")
    
    def list_influencers(self) -> List[str]:
        """Get list of tracked influencers."""
        return self.ai_influencers.copy()


if __name__ == "__main__":
    # Example usage
    fetcher = AITweetFetcher()
    
    print("AI Tweet Fetcher - Tracking tweets from AI influencers")
    print(f"Monitoring {len(fetcher.ai_influencers)} AI influencers")
    
    # Check if bearer token is available
    if not fetcher.bearer_token:
        print("\nError: Twitter Bearer Token not found!")
        print("Set TWITTER_BEARER_TOKEN environment variable to use this script.")
        print("You can get a Bearer Token from https://developer.twitter.com/")
        exit(1)
    
    print()
    
    # Fetch new tweets
    tweets = fetcher.fetch_new_list(max_results=10, max_per_user=2)
    
    print("\n" + "="*80)
    print("RECENT AI TWEETS")
    print("="*80)
    
    for tweet in tweets:
        print(f"@{tweet['author_username']}: {tweet['text'][:100]}...")
        print(f"  Created: {tweet['created_at'][:19]}")
        metrics = tweet.get('public_metrics', {})
        print(f"  Likes: {metrics.get('like_count', 0)}, Retweets: {metrics.get('retweet_count', 0)}")
        print(f"  URL: {tweet['url']}")
        print("-" * 80)
    
    # Show tracking stats
    stats = fetcher.get_tracking_stats()
    print(f"\nTracking stats: {stats}")