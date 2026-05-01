# Google フォームお問い合わせ機能 設定ガイド

このドキュメントでは、Pinly のお問い合わせページに Google フォームを埋め込むための手順を説明します。これにより、ユーザーからの問い合わせを確実に受け取ることができます。

## 1. Google フォームの作成

1.  **Google アカウントにログイン**します。
2.  [Google フォーム](https://docs.google.com/forms/u/0/)
    にアクセスし、「**新しいフォームを作成**」または「**空白**」を選択して新しいフォームを作成します。
3.  フォームのタイトルを「Pinly お問い合わせ」など、分かりやすい名前に設定します。
4.  以下の質問項目を追加することをお勧めします。
    *   **お問い合わせ種別** (プルダウンまたはラジオボタン)
        *   不適切な投稿の通報
        *   投稿の削除依頼
        *   バグ報告
        *   機能リクエスト
        *   法的・権利侵害に関する申し立て
        *   その他
    *   **返信用メールアドレス** (短い回答、必須ではない)
    *   **お問い合わせ内容** (段落、必須)
        *   投稿削除依頼の場合は、投稿日時・場所・テキスト内容など、できるだけ詳しく記載してもらうよう説明文を追加してください。

5.  各質問の「必須」設定を適切に行います（例: お問い合わせ種別、お問い合わせ内容は必須）。

## 2. Google フォームの埋め込み用 URL の取得

1.  フォームの作成が完了したら、右上の「**送信**」ボタンをクリックします。
2.  「送信」ダイアログが表示されたら、中央の「**<> 埋め込む**」アイコン（`<>` のようなマーク）をクリックします。
3.  「HTML を埋め込む」セクションが表示されます。ここに `<iframe>` タグのコードが表示されます。
4.  この `<iframe>` タグの中から、`src=
属性の値（`https://docs.google.com/forms/d/e/.../viewform?embedded=true` のようなURL）をコピーしてください。これが **Google フォームの埋め込み用 URL** です。

## 3. Pinly サイトへの埋め込み URL の設定

1.  Pinly リポジトリ内の `public/contact.html` ファイルを開きます。
2.  ファイル内の以下の行を探してください。
    ```javascript
    const GOOGLE_FORM_EMBED_URL = 'PLACEHOLDER_GOOGLE_FORM_URL';
    ```
3.  `'PLACEHOLDER_GOOGLE_FORM_URL'` の部分を、先ほどコピーした Google フォームの埋め込み用 URL に置き換えます。
    **例:**
    ```javascript
    const GOOGLE_FORM_EMBED_URL = 'https://docs.google.com/forms/d/e/1FAIpQLScz.../viewform?embedded=true';
    ```

## 4. 変更の保存とデプロイ

1.  `public/contact.html` ファイルを保存します。
2.  変更を GitHub にプッシュし、GitHub Pages にデプロイします。
    ```bash
    cd /home/ubuntu/service6
    git add public/contact.html
    git commit -m "feat: integrate Google Form for contact page"
    git push origin main
    ```

これで、Pinly のお問い合わせページに Google フォームが埋め込まれ、ユーザーからのメッセージを直接受け取れるようになります。

**重要**: Google フォームの設定で、新しい回答があった際にメールで通知を受け取るように設定しておくと、見落としを防げます。
