#!/usr/bin/env node

/**
 * Analyze potential duplicate BJJ news posts
 * Run with: node scripts/analyze-duplicates.js
 */

require("dotenv").config();
const supabase = require("../config");

// Calculate similarity between two strings (simple Levenshtein-based)
function similarity(s1, s2) {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

function levenshteinDistance(s1, s2) {
  const costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
}

async function analyzeDuplicates() {
  console.log("🔍 Analyzing BJJ news posts for duplicates...\n");

  try {
    // Get all news posts
    const { data: posts, error } = await supabase
      .from("posts")
      .select("id, content, created_at")
      .eq("user_id", "bjj-news-bot")
      .order("created_at", { ascending: false });

    if (error) throw error;

    console.log(`📊 Analyzing ${posts.length} total news posts\n`);

    // Extract URLs and titles
    const postData = posts.map(post => {
      const urlMatch = post.content.match(/Read more: (https?:\/\/[^\s\n]+)/);
      const url = urlMatch ? urlMatch[1] : null;
      const title = post.content.split("\n")[0].trim();
      
      return {
        id: post.id,
        url,
        title,
        content: post.content,
        created_at: post.created_at,
      };
    });

    // Find exact URL duplicates
    const urlMap = new Map();
    const exactUrlDuplicates = [];
    
    postData.forEach(post => {
      if (post.url) {
        if (urlMap.has(post.url)) {
          exactUrlDuplicates.push({
            original: urlMap.get(post.url),
            duplicate: post,
            reason: 'Exact URL match',
          });
        } else {
          urlMap.set(post.url, post);
        }
      }
    });

    // Find exact title duplicates
    const titleMap = new Map();
    const exactTitleDuplicates = [];
    
    postData.forEach(post => {
      if (titleMap.has(post.title)) {
        exactTitleDuplicates.push({
          original: titleMap.get(post.title),
          duplicate: post,
          reason: 'Exact title match',
        });
      } else {
        titleMap.set(post.title, post);
      }
    });

    // Find similar titles (potential duplicates)
    const similarTitleDuplicates = [];
    const SIMILARITY_THRESHOLD = 0.85; // 85% similar
    
    for (let i = 0; i < postData.length; i++) {
      for (let j = i + 1; j < postData.length; j++) {
        const sim = similarity(
          postData[i].title.toLowerCase(),
          postData[j].title.toLowerCase()
        );
        
        if (sim >= SIMILARITY_THRESHOLD && postData[i].url !== postData[j].url) {
          similarTitleDuplicates.push({
            post1: postData[i],
            post2: postData[j],
            similarity: (sim * 100).toFixed(1) + '%',
            reason: 'Similar title',
          });
        }
      }
    }

    // Report findings
    console.log("📋 ANALYSIS RESULTS\n");
    console.log("=" .repeat(80));
    
    console.log(`\n1️⃣  EXACT URL DUPLICATES: ${exactUrlDuplicates.length}`);
    if (exactUrlDuplicates.length > 0) {
      exactUrlDuplicates.forEach((dup, idx) => {
        console.log(`\n   ${idx + 1}. ${dup.duplicate.title.substring(0, 60)}...`);
        console.log(`      Original: ${new Date(dup.original.created_at).toLocaleDateString()}`);
        console.log(`      Duplicate: ${new Date(dup.duplicate.created_at).toLocaleDateString()}`);
        console.log(`      URL: ${dup.duplicate.url}`);
      });
    }

    console.log(`\n2️⃣  EXACT TITLE DUPLICATES: ${exactTitleDuplicates.length}`);
    if (exactTitleDuplicat