import { NextResponse } from 'next/server';

const API_BASE = 'https://lightmake.site';
const API_KEY = 'sk_894dc01032e91c916eccb65d154343fe';

export async function GET() {
  try {
    const response = await fetch(`${API_BASE}/api/v1/categories`, {
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 3600 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Categories API error', status: response.status },
        { status: response.status }
      );
    }

    const data = await response.json();
    return NextResponse.json(data);
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch categories', details: String(error) },
      { status: 500 }
    );
  }
}
