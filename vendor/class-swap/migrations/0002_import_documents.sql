-- Keep large plan histories out of a single D1 TEXT value. Each staged document
-- is bounded independently; the final trigger still changes all user state atomically.
ALTER TABLE import_staging ADD COLUMN kind TEXT NOT NULL DEFAULT 'legacy';
ALTER TABLE import_staging ADD COLUMN document_id TEXT NOT NULL DEFAULT '';
DROP TRIGGER initial_import_apply;
CREATE TRIGGER initial_import_apply AFTER INSERT ON initial_import BEGIN
  UPDATE state SET dataset=(SELECT group_concat(content,'') FROM
    (SELECT content FROM import_staging WHERE job_id=NEW.job_id AND kind='dataset' ORDER BY part)),
    revision=revision+1,data_rev=data_rev+1,plan_rev=plan_rev+1 WHERE id=1;
  INSERT INTO plans(id,version,status,content)
    SELECT json_extract(doc,'$.id'),json_extract(doc,'$.version'),json_extract(doc,'$.status'),doc FROM
    (SELECT document_id,group_concat(content,'') AS doc FROM
      (SELECT document_id,content FROM import_staging WHERE job_id=NEW.job_id AND kind='plan' ORDER BY part) GROUP BY document_id);
  INSERT INTO reservations(teacher_id,actual_date,period,plan_id)
    SELECT json_extract(j.value,'$.teacher'),json_extract(j.value,'$.date'),json_extract(j.value,'$.period'),json_extract(j.value,'$.plan') FROM
    (SELECT document_id,group_concat(content,'') AS doc FROM
      (SELECT document_id,content FROM import_staging WHERE job_id=NEW.job_id AND kind='reservations' ORDER BY part) GROUP BY document_id),json_each(doc) AS j;
  INSERT INTO imports(hash,imported_at,counts) VALUES(NEW.hash,strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.content);
  DELETE FROM import_staging WHERE job_id=NEW.job_id;
  DELETE FROM initial_import WHERE job_id=NEW.job_id;
END;
