import { NextRequest, NextResponse } from 'next/server';

const API_BASE = 'https://lightmake.site';
const API_KEY = 'sk_894dc01032e91c916eccb65d154343fe';

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  const limit = searchParams.get('limit') || '20';

  if (!q.trim()) {
    return NextResponse.json({ items: [] });
  }

  try {
    const url = `${API_BASE}/api/v1/search?q=${encodeURIComponent(q)}&limit=${limit}`;
    const response = await fetch(url, {
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 60 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Search API error', status: response.status },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to search skills', details: String(error) },
      { status: 500 }
    );
  }
}
