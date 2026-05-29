import { NextResponse } from 'next/server';

const API_BASE = 'https://lightmake.site';
const API_KEY = 'sk_894dc01032e91c916eccb65d154343fe';

export async function GET() {
  try {
    const response = await fetch(`${API_BASE}/api/skills/top`, {
      headers: {
        'X-API-Key': API_KEY,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 300 },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: 'Top skills API error', status: response.status },
        { status: response.status }
      );
    }

    const data = await response.json();
    // API returns {"code":0,"data":{"skills":[...],"total":N}} — unwrap to {"skills":[...]}
    const skills = data?.data?.skills || data?.skills || [];
    return NextResponse.json({ skills });
  } catch (error) {
    return NextResponse.json(
      { error: 'Failed to fetch top skills', details: String(error) },
      { status: 500 }
    );
  }
}
