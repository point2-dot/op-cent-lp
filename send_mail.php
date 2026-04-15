<?php
// 文字化け対策
mb_language("Japanese");
mb_internal_encoding("UTF-8");

// フォームが送信された（POSTリクエスト）場合のみ処理を実行
if ($_SERVER["REQUEST_METHOD"] == "POST") {
    
    // 入力されたデータの受け取りと安全化（エスケープ処理）
    $company = htmlspecialchars($_POST['companyName'], ENT_QUOTES, 'UTF-8');
    $name    = htmlspecialchars($_POST['contactName'], ENT_QUOTES, 'UTF-8');
    $email   = htmlspecialchars($_POST['contactEmail'], ENT_QUOTES, 'UTF-8');
    $contact_message = htmlspecialchars($_POST['contactMessage'], ENT_QUOTES, 'UTF-8');

    // -------------------------
    // メールの設定
    // -------------------------
    // 送信先のメールアドレス
    $to = "info@point2-studio.com";

    // メールの件名
    $subject = "【Op+cent】LPからのお問い合わせ";

    // メールの本文を作成
    $message = "Op+centのランディングページからお問い合わせがありました。\n\n";
    $message .= "■貴社名・教室名\n";
    $message .= $company . "\n\n";
    $message .= "■ご担当者様名\n";
    $message .= $name . "\n\n";
    $message .= "■メールアドレス\n";
    $message .= $email . "\n\n";
    $message .= "■お問い合わせ内容\n";
    $message .= $contact_message . "\n";

    // 送信元の情報（お客様のメールアドレスをFromとReply-Toに設定し、返信しやすくします）
    $headers = "From: " . $email . "\r\n";
    $headers .= "Reply-To: " . $email . "\r\n";

    // -------------------------
    // メール送信処理
    // -------------------------
    if (mb_send_mail($to, $subject, $message, $headers)) {
        // 送信成功時の処理：アラートを出してトップページへ戻る
        echo "<script>
            alert('お問い合わせを送信しました。担当者からの連絡をお待ちください。');
            window.location.href = 'index.html';
        </script>";
    } else {
        // 送信失敗時の処理：アラートを出して前のページへ戻る
        echo "<script>
            alert('メールの送信に失敗しました。お手数ですが時間をおいて再度お試しください。');
            window.history.back();
        </script>";
    }

} else {
    // URLを直接叩かれた場合などはトップページへ強制移動
    header("Location: index.html");
    exit();
}
?>